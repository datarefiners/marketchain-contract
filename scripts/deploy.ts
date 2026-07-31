import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying MarketChainAnchorRegistry...");
  console.log("  Network:", (await deployer.provider.getNetwork()).name);
  console.log("  Deployer:", deployer.address);
  console.log("  Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "POL / MATIC");

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
  console.log("  Anchor count:", await registry.anchorCount());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
