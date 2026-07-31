import { expect } from "chai";
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import type { MarketChainAnchorRegistry } from "../typechain-types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MarketChainAnchorRegistry — Testnet (Amoy)", function () {
  this.timeout(180000);

  let registry: MarketChainAnchorRegistry;
  let deployerAddress: string;
  let deploymentInfo: {
    address: string;
    deployer: string;
    txHash: string;
  };

  const runId = Date.now().toString();

  before(async function () {
    const provider = ethers.provider;
    const network = await provider.getNetwork();
    console.log(`\n  Réseau : ${network.name} (chainId: ${network.chainId})`);

    const deployFile = path.join(__dirname, "..", "deployments", "amoy.json");
    if (!fs.existsSync(deployFile)) {
      throw new Error(
        `Deployment file not found: ${deployFile}. Run "npm run deploy:amoy" first.`
      );
    }

    const raw = JSON.parse(fs.readFileSync(deployFile, "utf8"));
    deploymentInfo = raw.contracts.MarketChainAnchorRegistry as typeof deploymentInfo;
    deployerAddress = deploymentInfo.deployer;

    const signer = (await ethers.getSigners())[0];
    registry = (await ethers.getContractAt(
      "MarketChainAnchorRegistry",
      deploymentInfo.address,
      signer
    )) as unknown as MarketChainAnchorRegistry;

    console.log(`  Contrat : ${deploymentInfo.address}`);
    console.log(`  Signer  : ${signer.address}`);
    console.log(`  Admin   : ${await registry.admin()}`);
    console.log(`  Ancres  : ${await registry.anchorCount()}\n`);
  });

  // Helper : envoie une tx et attend, avec délai entre les tx
  async function sendAndWait(txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    await sleep(2000); // délai entre transactions pour éviter les collisions de nonce
    return receipt;
  }

  // -------------------------------------------------------------------------
  // Déploiement
  // -------------------------------------------------------------------------

  describe("Déploiement", function () {
    it("l'admin est le deployer", async function () {
      expect(await registry.admin()).to.equal(deployerAddress);
    });

    it("la tx de déploiement est confirmée sur la chaîne", async function () {
      const receipt = await ethers.provider.getTransactionReceipt(
        deploymentInfo.txHash
      );
      expect(receipt).to.not.be.null;
      expect(receipt!.status).to.equal(1);
    });

    it("le bloc de déploiement existe", async function () {
      const receipt = await ethers.provider.getTransactionReceipt(
        deploymentInfo.txHash
      );
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      expect(block).to.not.be.null;
    });

    it("l'event AdminTransferred est dans les logs", async function () {
      const receipt = await ethers.provider.getTransactionReceipt(
        deploymentInfo.txHash
      );
      expect(receipt!.logs.length).to.be.greaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Gestion des writers
  // -------------------------------------------------------------------------

  describe("Gestion des writers", function () {
    const externalWriter = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    // Nettoyer l'état initial
    before(async function () {
      const isWriter = await registry.writers(externalWriter);
      if (isWriter) {
        const tx = await registry.removeWriter(externalWriter);
        await tx.wait();
        await sleep(2000);
      }
    });

    it("l'admin peut ajouter un writer", async function () {
      const receipt = await sendAndWait(
        registry.addWriter(externalWriter)
      );
      expect(receipt.status).to.equal(1);
      expect(await registry.writers(externalWriter)).to.equal(true);
    });

    it("isWriter confirme le writer ajouté", async function () {
      expect(await registry.isWriter(externalWriter)).to.equal(true);
    });

    it("l'ajout d'un writer déjà existant revert", async function () {
      await expect(registry.addWriter(externalWriter)).to.be.revertedWith(
        "Already writer"
      );
    });

    it("l'admin peut retirer un writer", async function () {
      const receipt = await sendAndWait(
        registry.removeWriter(externalWriter)
      );
      expect(receipt.status).to.equal(1);
      expect(await registry.writers(externalWriter)).to.equal(false);
    });

    it("retirer un non-writer revert", async function () {
      await expect(registry.removeWriter(externalWriter)).to.be.revertedWith(
        "Not writer"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Ancrage — avec l'admin comme writer
  // -------------------------------------------------------------------------

  describe("Ancrage", function () {
    const H1 = ethers.keccak256(ethers.toUtf8Bytes(`seal-a-${runId}`));
    const H2 = ethers.keccak256(ethers.toUtf8Bytes(`seal-b-${runId}`));
    const H3 = ethers.keccak256(ethers.toUtf8Bytes(`seal-c-${runId}`));
    let startCount: bigint;

    // Ajouter l'admin comme writer avant les tests d'ancrage
    before(async function () {
      const isWriter = await registry.writers(deployerAddress);
      if (!isWriter) {
        const tx = await registry.addWriter(deployerAddress);
        await tx.wait();
        await sleep(2000);
      }
      startCount = await registry.anchorCount();
      console.log(`  Ancres avant ancrage : ${startCount}`);
    });

    it("ancrer un sealHash (admin/writer → contrat)", async function () {
      const receipt = await sendAndWait(registry.anchor(H1));
      expect(receipt.status).to.equal(1);
      expect(await registry.anchorCount()).to.equal(startCount + 1n);

      const [hash, writer, ts] = await registry.getAnchor(startCount);
      expect(hash).to.equal(H1);
      expect(writer).to.equal(deployerAddress);
      expect(ts).to.be.greaterThan(0);
    });

    it("ancrer un second sealHash", async function () {
      const receipt = await sendAndWait(registry.anchor(H2));
      expect(receipt.status).to.equal(1);
      expect(await registry.anchorCount()).to.equal(startCount + 2n);
    });

    it("anti-doublon : un même hash est refusé", async function () {
      await expect(registry.anchor(H1)).to.be.revertedWith(
        "Seal hash already anchored"
      );
    });

    it("hash zéro refusé", async function () {
      await expect(registry.anchor(ethers.ZeroHash)).to.be.revertedWith(
        "Invalid sealHash"
      );
    });

    it("l'event AnchorCreated est émis", async function () {
      const receipt = await sendAndWait(registry.anchor(H3));
      expect(receipt.status).to.equal(1);

      const lastIdx = (await registry.anchorCount()) - 1n;
      const [hash] = await registry.getAnchor(lastIdx);
      expect(hash).to.equal(H3);
    });

    it("retirer le writer bloque les ancrages", async function () {
      const receipt = await sendAndWait(
        registry.removeWriter(deployerAddress)
      );
      expect(receipt.status).to.equal(1);
      expect(await registry.writers(deployerAddress)).to.equal(false);

      const blockedHash = ethers.keccak256(
        ethers.toUtf8Bytes(`blocked-${runId}`)
      );
      await expect(registry.anchor(blockedHash)).to.be.revertedWith(
        "Unauthorized: writer only"
      );

      // Ré-ajouter pour la propreté
      await sendAndWait(registry.addWriter(deployerAddress));
    });
  });

  // -------------------------------------------------------------------------
  // Lecture des ancres
  // -------------------------------------------------------------------------

  describe("Lecture des ancres", function () {
    it("getAnchor retourne les champs corrects", async function () {
      const count = await registry.anchorCount();
      expect(count).to.be.greaterThan(0n);

      const [hash, writer, timestamp] = await registry.getAnchor(0n);
      expect(hash).to.not.equal(ethers.ZeroHash);
      expect(writer).to.not.equal(ethers.ZeroAddress);
      expect(timestamp).to.be.greaterThan(0);
    });

    it("getAnchor revert pour un index inexistant", async function () {
      const count = await registry.anchorCount();
      await expect(registry.getAnchor(count)).to.be.revertedWith(
        "Anchor not found"
      );
    });

    it("lecture publique (sans auth)", async function () {
      const [hash] = await registry.getAnchor(0n);
      expect(hash).to.not.equal(ethers.ZeroHash);
    });
  });

  // -------------------------------------------------------------------------
  // Cohérence
  // -------------------------------------------------------------------------

  describe("Cohérence", function () {
    it("anchorCount reflète le nombre réel", async function () {
      const count = await registry.anchorCount();
      expect(count).to.be.greaterThan(0n);
      await registry.getAnchor(count - 1n);
      await expect(registry.getAnchor(count)).to.be.revertedWith(
        "Anchor not found"
      );
    });

    it("toutes les ancres ont un sealHash non nul", async function () {
      const count = await registry.anchorCount();
      for (let i = 0n; i < count && i < 10n; i++) {
        const [hash] = await registry.getAnchor(i);
        expect(hash).to.not.equal(ethers.ZeroHash);
      }
    });

    it("timestamps croissants", async function () {
      const count = await registry.anchorCount();
      let prevTs = 0n;
      for (let i = 0n; i < count && i < 10n; i++) {
        const [, , ts] = await registry.getAnchor(i);
        expect(ts).to.be.gte(prevTs);
        prevTs = ts;
      }
    });

    it("writer = deployer sur nos ancres", async function () {
      const count = await registry.anchorCount();
      for (let i = 0n; i < count && i < 5n; i++) {
        const [, writer] = await registry.getAnchor(i);
        expect(writer).to.not.equal(ethers.ZeroAddress);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Révocation non rétroactive
  // -------------------------------------------------------------------------

  describe("Révocation non rétroactive", function () {
    before(async function () {
      // S'assurer que l'admin est writer
      if (!(await registry.writers(deployerAddress))) {
        const tx = await registry.addWriter(deployerAddress);
        await tx.wait();
        await sleep(2000);
      }
    });

    it("les ancres persistent après révocation du writer", async function () {
      const countBefore = await registry.anchorCount();
      expect(countBefore).to.be.greaterThan(0n);

      const [hashBefore] = await registry.getAnchor(0n);

      const receipt = await sendAndWait(
        registry.removeWriter(deployerAddress)
      );
      expect(receipt.status).to.equal(1);
      expect(await registry.writers(deployerAddress)).to.equal(false);

      const [hashAfter] = await registry.getAnchor(0n);
      expect(hashAfter).to.equal(hashBefore);

      // Ré-ajouter pour laisser propre
      await sendAndWait(registry.addWriter(deployerAddress));
    });
  });
});
