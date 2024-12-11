#!/usr/bin/env bun

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

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

async function deployNTT(config: DeploymentConfig) {
  const { projectName, baseToken, solanaToken, solanaPayer, mode = DEFAULT_CONFIG.mode } = config;

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