#!/usr/bin/env bun

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface DeploymentConfig {
  projectName: string;
  baseToken: string;
  solanaToken: string;
  solanaPayer: string;
  mode?: 'burning' | 'locking';
}

const DEFAULT_CONFIG = {
  network: 'Testnet',
  mode: 'burning' as const,
  rpcEndpoints: {
    Base: 'https://sepolia.base.org',
    Solana: 'https://api.devnet.solana.com'
  }
};

function printUsage() {
  console.log(`
Usage: deploy-ntt [options]

Required:
    --project-name      Name of the NTT project
    --base-token       Base chain token address
    --solana-token     Solana chain token address
    --solana-payer     Path to Solana payer keypair file

Optional:
    --mode             Token transfer mode (burning/locking) [default: burning]
    -h, --help         Show this help message

Example:
    deploy-ntt --project-name my-token-bridge \\
              --base-token 0x1234... \\
              --solana-token TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \\
              --solana-payer ~/.config/solana/id.json \\
              --mode locking
  `);
  process.exit(1);
}

function checkPrerequisites() {
  try {
    // Check for required tools
    execSync('which solana');
    execSync('which spl-token');
    execSync('which anchor');
    execSync('which forge');
    execSync('which ntt');
  } catch (error) {
    console.error('Missing required tools. Please install:');
    console.error('- Solana CLI tools (solana, spl-token)');
    console.error('- Anchor (https://www.anchor-lang.com/docs/installation)');
    console.error('- Foundry (forge) (https://book.getfoundry.sh/getting-started/installation)');
    console.error('- NTT CLI (https://wormhole.com/docs/build/contract-integrations/native-token-transfers/deployment-process/install-cli)');
    process.exit(1);
  }
}

function parseArgs(): DeploymentConfig {
  const args = process.argv.slice(2);
  const config: Partial<DeploymentConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--project-name':
        config.projectName = args[++i];
        break;
      case '--base-token':
        config.baseToken = args[++i];
        break;
      case '--solana-token':
        config.solanaToken = args[++i];
        break;
      case '--solana-payer':
        config.solanaPayer = args[++i];
        break;
      case '--mode':
        const mode = args[++i];
        if (mode !== 'burning' && mode !== 'locking') {
          console.error("Error: mode must be either 'burning' or 'locking'");
          process.exit(1);
        }
        config.mode = mode;
        break;
      case '-h':
      case '--help':
        printUsage();
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
    }
  }

  // Validate required parameters
  const requiredParams = ['projectName', 'baseToken', 'solanaToken', 'solanaPayer'] as const;
  for (const param of requiredParams) {
    if (!config[param]) {
      console.error(`Error: Missing required parameter --${param.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`);
      printUsage();
    }
  }

  // Validate Solana payer file exists
  if (!existsSync(config.solanaPayer!)) {
    console.error(`Error: Solana payer file not found: ${config.solanaPayer}`);
    process.exit(1);
  }

  return config as DeploymentConfig;
}

async function findNttKeypairFile(): Promise<string> {
  try {
    const output = execSync('ls -1 | grep -i "^ntt.*\.json$"', { 
      encoding: 'utf8',
    });
    
    const files = output.trim().split('\n');
    
    if (!files || files.length === 0 || (files.length === 1 && files[0] === '')) {
      throw new Error('No NTT keypair file found in current directory');
    }

    if (files.length > 1) {
      throw new Error('Multiple NTT keypair files found. Please ensure only one exists.');
    }

    return files[0];
  } catch (error) {
    if ((error as any).status === 1) {
      // grep returns status 1 when no matches found
      throw new Error('No NTT keypair file found in current directory');
    }
    throw error;
  }
}

async function prepareSolanaDeployment(config: DeploymentConfig) {
  const { solanaToken, mode } = config;

  // Generate program keypair if in burning mode
  if (mode === 'burning') {
    console.log('Generating program keypair for burning mode...');
    execSync('solana-keygen grind --starts-with ntt:1 --ignore-case', { stdio: 'inherit' });
    
    // Find the generated keypair file
    const programKeypairFile = await findNttKeypairFile();
    console.log('Program keypair file:', programKeypairFile);

    // Get token authority PDA
    const tokenAuthorityPDA = execSync(`ntt solana token-authority ${programKeypairFile}`).toString().trim().slice(0, -4);
    
    // Set mint authority
    console.log('Setting mint authority...');
    execSync(`spl-token authorize ${solanaToken} mint ${tokenAuthorityPDA}`, { stdio: 'inherit' });
  }
}

async function deployNTT(config: DeploymentConfig) {
  const { projectName, baseToken, solanaToken, solanaPayer, mode = DEFAULT_CONFIG.mode } = config;

  // Check prerequisites
  checkPrerequisites();

  console.log(`Creating new NTT project: ${projectName}`);
  execSync(`ntt new ${projectName}`);
  process.chdir(projectName);

  console.log(`Initializing project for ${DEFAULT_CONFIG.network}`);
  execSync(`ntt init ${DEFAULT_CONFIG.network}`);

  // Create overrides.json
  const overrides = {
    chains: {
      Base: {
        rpc: DEFAULT_CONFIG.rpcEndpoints.Base
      },
      Solana: {
        rpc: DEFAULT_CONFIG.rpcEndpoints.Solana
      }
    }
  };

  writeFileSync('overrides.json', JSON.stringify(overrides, null, 2));

  // Prepare Solana deployment
  await prepareSolanaDeployment(config);

  console.log('Adding Solana chain...');
  execSync(
    `ntt add-chain Solana --token ${solanaToken} --mode ${mode} --latest --payer ${solanaPayer}`,
    { stdio: 'inherit' }
  );

  console.log('Adding Base chain...');
  execSync(
    `ntt add-chain Base --token ${baseToken} --mode ${mode} --latest --skip-verify`,
    { stdio: 'inherit' }
  );

  console.log('Pushing configuration...');
  execSync(`ntt push --yes --payer ${solanaPayer}`, { stdio: 'inherit' });

  console.log('Deployment complete! Configuration saved in deployment.json');
  const deploymentJson = execSync('cat deployment.json').toString();
  console.log(deploymentJson);
}

// Main execution
try {
  const config = parseArgs();
  deployNTT(config).catch(console.error);
} catch (error) {
  console.error('Deployment failed:', error);
  process.exit(1);
} 