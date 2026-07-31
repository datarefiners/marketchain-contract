import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();

  const networkName = network.name;
  const chainId = (await deployer.provider.getNetwork()).chainId;

  console.log("Deploying MarketChainAnchorRegistry...");
  console.log("  Network:", networkName);
  console.log("  Chain ID:", Number(chainId));
  console.log("  Deployer:", deployer.address);
  console.log(
    "  Balance:",
    ethers.formatEther(await deployer.provider.getBalance(deployer.address)),
    "POL / MATIC"
  );

  const RegistryFactory = await ethers.getContractFactory(
    "MarketChainAnchorRegistry"
  );

  const registry = await RegistryFactory.deploy(deployer.address);
  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();

  console.log("\nContract deployed:");
  console.log("  Address:", contractAddress);
  console.log("  Tx hash:", deployTx?.hash);
  console.log("  Admin:", deployer.address);
  console.log("  Anchor count:", (await registry.anchorCount()).toString());

  // Sauvegarder l'adresse dans deployments/<network>.json
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const deploymentFile = path.join(deploymentsDir, `${networkName}.json`);
  const deployment = {
    network: networkName,
    chainId: Number(chainId),
    contracts: {
      MarketChainAnchorRegistry: {
        address: contractAddress,
        deployer: deployer.address,
        txHash: deployTx?.hash ?? "",
      },
    },
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`\nDeployment saved to: ${deploymentFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
