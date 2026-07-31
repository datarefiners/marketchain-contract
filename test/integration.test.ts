import { expect } from "chai";
import { ethers } from "hardhat";
import { EventLog } from "ethers";
import type { MarketChainAnchorRegistry } from "../typechain-types";

describe("MarketChainAnchorRegistry — Intégration (localhost)", function () {
  let registry: MarketChainAnchorRegistry;
  let deployTxHash: string;

  const SEAL_HASH_1 = ethers.keccak256(ethers.toUtf8Bytes("facture-001"));
  const SEAL_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("facture-002"));

  before(async function () {
    this.timeout(30000);

    const provider = ethers.provider;
    const network = await provider.getNetwork();
    console.log(`\n  Réseau : ${network.name} (chainId: ${network.chainId})`);

    const signers = await ethers.getSigners();
    const [admin, writer, other] = signers;

    console.log(`  Admin  : ${admin.address}`);
    console.log(`  Writer : ${writer.address}`);
    console.log(`  Other  : ${other.address}`);
    console.log(`  Balance admin : ${ethers.formatEther(await provider.getBalance(admin.address))} ETH`);

    const Factory = await ethers.getContractFactory("MarketChainAnchorRegistry");
    registry = (await Factory.connect(admin).deploy(
      admin.address
    )) as unknown as MarketChainAnchorRegistry;
    await registry.waitForDeployment();

    const deployTx = registry.deploymentTransaction();
    deployTxHash = deployTx?.hash ?? "inconnu";

    const contractAddress = await registry.getAddress();
    console.log(`  Contrat déployé : ${contractAddress}`);
    console.log(`  Tx deploy       : ${deployTxHash}\n`);
  });

  // -------------------------------------------------------------------------
  // Déploiement
  // -------------------------------------------------------------------------

  describe("Déploiement", function () {
    it("l'admin est le deployer", async function () {
      const [admin] = await ethers.getSigners();
      expect(await registry.admin()).to.equal(admin.address);
    });

    it("le compteur d'ancres est à 0", async function () {
      expect(await registry.anchorCount()).to.equal(0);
    });

    it("l'event AdminTransferred a été émis", async function () {
      const [admin] = await ethers.getSigners();

      const filter = registry.filters.AdminTransferred();
      const events = await registry.queryFilter(filter);
      expect(events.length).to.equal(1);

      const log = events[0] as unknown as EventLog;
      expect(log.args.previousAdmin).to.equal(ethers.ZeroAddress);
      expect(log.args.newAdmin).to.equal(admin.address);
    });

    it("la transaction de déploiement est confirmée", async function () {
      const receipt = await ethers.provider.getTransactionReceipt(deployTxHash);
      expect(receipt).to.not.be.null;
      expect(receipt!.status).to.equal(1);
    });
  });

  // -------------------------------------------------------------------------
  // Gestion des writers
  // -------------------------------------------------------------------------

  describe("Gestion des writers", function () {
    it("l'admin ajoute un writer", async function () {
      const [admin, writer] = await ethers.getSigners();

      const tx = await registry.connect(admin).addWriter(writer.address);
      const receipt = await tx.wait();

      expect(receipt!.status).to.equal(1);
      expect(await registry.writers(writer.address)).to.equal(true);
    });

    it("le writer est bien autorisé", async function () {
      const [, writer] = await ethers.getSigners();
      expect(await registry.isWriter(writer.address)).to.equal(true);
    });

    it("un non-admin ne peut pas ajouter de writer", async function () {
      const [, , other] = await ethers.getSigners();

      await expect(
        registry.connect(other).addWriter(other.address)
      ).to.be.revertedWith("Unauthorized: admin only");
    });

    it("l'admin révoque un writer", async function () {
      const [admin, writer] = await ethers.getSigners();

      const tx = await registry.connect(admin).removeWriter(writer.address);
      const receipt = await tx.wait();

      expect(receipt!.status).to.equal(1);
      expect(await registry.writers(writer.address)).to.equal(false);
    });

    it("l'admin ré-ajoute le writer pour la suite", async function () {
      const [admin, writer] = await ethers.getSigners();

      await registry.connect(admin).addWriter(writer.address);
      expect(await registry.writers(writer.address)).to.equal(true);
    });
  });

  // -------------------------------------------------------------------------
  // Ancrage
  // -------------------------------------------------------------------------

  describe("Ancrage", function () {
    it("le writer ancre un premier sealHash", async function () {
      const [, writer] = await ethers.getSigners();

      const tx = await registry.connect(writer).anchor(SEAL_HASH_1);
      const receipt = await tx.wait();

      expect(receipt!.status).to.equal(1);
      expect(await registry.anchorCount()).to.equal(1);

      const [hash, w, ts] = await registry.getAnchor(0);
      expect(hash).to.equal(SEAL_HASH_1);
      expect(w).to.equal(writer.address);
      expect(ts).to.be.greaterThan(0);
    });

    it("le writer ancre un second sealHash", async function () {
      const [, writer] = await ethers.getSigners();

      const tx = await registry.connect(writer).anchor(SEAL_HASH_2);
      const receipt = await tx.wait();

      expect(receipt!.status).to.equal(1);
      expect(await registry.anchorCount()).to.equal(2);

      const [hash] = await registry.getAnchor(1);
      expect(hash).to.equal(SEAL_HASH_2);
    });

    it("l'anti-doublon bloque un second ancrage du même hash", async function () {
      const [, writer] = await ethers.getSigners();

      await expect(
        registry.connect(writer).anchor(SEAL_HASH_1)
      ).to.be.revertedWith("Seal hash already anchored");
    });

    it("un non-writer ne peut pas ancrer", async function () {
      const [, , other] = await ethers.getSigners();

      await expect(
        registry
          .connect(other)
          .anchor(ethers.keccak256(ethers.toUtf8Bytes("hack")))
      ).to.be.revertedWith("Unauthorized: writer only");
    });

    it("les ancres sont lisibles publiquement", async function () {
      const [, writer, other] = await ethers.getSigners();

      const [hash, w, ts] = await registry.connect(other).getAnchor(0);
      expect(hash).to.equal(SEAL_HASH_1);
      expect(w).to.equal(writer.address);
      expect(ts).to.be.greaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Transfert d'admin
  // -------------------------------------------------------------------------

  describe("Transfert d'admin", function () {
    it("l'admin transfère les droits", async function () {
      const [admin, , other] = await ethers.getSigners();

      const tx = await registry.connect(admin).transferAdmin(other.address);
      const receipt = await tx.wait();

      expect(receipt!.status).to.equal(1);
      expect(await registry.admin()).to.equal(other.address);
    });

    it("l'ancien admin ne peut plus gérer les writers", async function () {
      const [admin, writer] = await ethers.getSigners();

      await expect(
        registry.connect(admin).addWriter(writer.address)
      ).to.be.revertedWith("Unauthorized: admin only");
    });

    it("le nouvel admin restaure l'admin d'origine", async function () {
      const [admin, , other] = await ethers.getSigners();

      await registry.connect(other).transferAdmin(admin.address);
      expect(await registry.admin()).to.equal(admin.address);
    });
  });

  // -------------------------------------------------------------------------
  // Cohérence finale
  // -------------------------------------------------------------------------

  describe("Cohérence", function () {
    it("les 2 ancres sont toujours intactes", async function () {
      const [, writer] = await ethers.getSigners();

      expect(await registry.anchorCount()).to.equal(2);

      const [h0, w0] = await registry.getAnchor(0);
      const [h1, w1] = await registry.getAnchor(1);

      expect(h0).to.equal(SEAL_HASH_1);
      expect(w0).to.equal(writer.address);
      expect(h1).to.equal(SEAL_HASH_2);
      expect(w1).to.equal(writer.address);
    });

    it("le bloc contient les transactions", async function () {
      const receipt = await ethers.provider.getTransactionReceipt(deployTxHash);
      expect(receipt).to.not.be.null;

      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      expect(block).to.not.be.null;
      expect(block!.transactions.length).to.be.greaterThan(0);
    });
  });
});
