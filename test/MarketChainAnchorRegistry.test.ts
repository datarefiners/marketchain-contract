import { expect } from "chai";
import { ethers } from "hardhat";
import { EventLog } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import type { MarketChainAnchorRegistry } from "../typechain-types";

describe("MarketChainAnchorRegistry", function () {
  async function deployFixture() {
    const [admin, writer, other, newAdmin] = await ethers.getSigners();

    const RegistryFactory = await ethers.getContractFactory(
      "MarketChainAnchorRegistry"
    );
    const registry = (await RegistryFactory.deploy(
      admin.address
    )) as unknown as MarketChainAnchorRegistry;

    return { registry, admin, writer, other, newAdmin };
  }

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", function () {
    it("should set the deployer as admin", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      expect(await registry.admin()).to.equal(admin.address);
    });

    it("should have anchorCount = 0", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.anchorCount()).to.equal(0);
    });

    it("should emit AdminTransferred on deployment", async function () {
      const { admin } = await loadFixture(deployFixture);

      const RegistryFactory = await ethers.getContractFactory(
        "MarketChainAnchorRegistry"
      );

      const registry = await RegistryFactory.deploy(admin.address);

      const filter = registry.filters.AdminTransferred();
      const events = await registry.queryFilter(filter);
      expect(events.length).to.equal(1);

      const log = events[0] as EventLog;
      expect(log.args.previousAdmin).to.equal(ethers.ZeroAddress);
      expect(log.args.newAdmin).to.equal(admin.address);
    });

    it("should revert if initial admin is zero address", async function () {
      const RegistryFactory = await ethers.getContractFactory(
        "MarketChainAnchorRegistry"
      );
      await expect(
        RegistryFactory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid admin");
    });
  });

  // ---------------------------------------------------------------------------
  // Writer management
  // ---------------------------------------------------------------------------

  describe("Writer management", function () {
    it("should allow admin to add a writer", async function () {
      const { registry, admin, writer } = await loadFixture(deployFixture);

      await expect(registry.addWriter(writer.address))
        .to.emit(registry, "WriterAdded")
        .withArgs(writer.address);

      expect(await registry.writers(writer.address)).to.equal(true);
    });

    it("should revert if non-admin tries to add a writer", async function () {
      const { registry, writer, other } = await loadFixture(deployFixture);

      await expect(
        registry.connect(other).addWriter(writer.address)
      ).to.be.revertedWith("Unauthorized: admin only");
    });

    it("should revert adding an already-existing writer", async function () {
      const { registry, admin, writer } = await loadFixture(deployFixture);

      await registry.connect(admin).addWriter(writer.address);
      await expect(
        registry.connect(admin).addWriter(writer.address)
      ).to.be.revertedWith("Already writer");
    });

    it("should revert adding zero address as writer", async function () {
      const { registry, admin } = await loadFixture(deployFixture);

      await expect(
        registry.connect(admin).addWriter(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid wallet");
    });

    it("should allow admin to remove a writer", async function () {
      const { registry, admin, writer } = await loadFixture(deployFixture);

      await registry.connect(admin).addWriter(writer.address);

      await expect(registry.connect(admin).removeWriter(writer.address))
        .to.emit(registry, "WriterRemoved")
        .withArgs(writer.address);

      expect(await registry.writers(writer.address)).to.equal(false);
    });

    it("should revert removing a non-writer", async function () {
      const { registry, admin, writer } = await loadFixture(deployFixture);

      await expect(
        registry.connect(admin).removeWriter(writer.address)
      ).to.be.revertedWith("Not writer");
    });
  });

  // ---------------------------------------------------------------------------
  // Anchoring
  // ---------------------------------------------------------------------------

  describe("Anchoring", function () {
    async function anchoredFixture() {
      const base = await deployFixture();
      await base.registry
        .connect(base.admin)
        .addWriter(base.writer.address);
      return base;
    }

    it("should create an anchor and emit AnchorCreated", async function () {
      const { registry, writer } = await loadFixture(anchoredFixture);

      const sealHash = ethers.keccak256(ethers.toUtf8Bytes("document-1"));

      await expect(registry.connect(writer).anchor(sealHash))
        .to.emit(registry, "AnchorCreated")
        .withArgs(0, sealHash, writer.address, anyValue);

      expect(await registry.anchorCount()).to.equal(1);
    });

    it("should increment anchorCount after each anchor", async function () {
      const { registry, writer } = await loadFixture(anchoredFixture);

      const h1 = ethers.keccak256(ethers.toUtf8Bytes("d1"));
      const h2 = ethers.keccak256(ethers.toUtf8Bytes("d2"));
      const h3 = ethers.keccak256(ethers.toUtf8Bytes("d3"));

      await registry.connect(writer).anchor(h1);
      expect(await registry.anchorCount()).to.equal(1);

      await registry.connect(writer).anchor(h2);
      expect(await registry.anchorCount()).to.equal(2);

      await registry.connect(writer).anchor(h3);
      expect(await registry.anchorCount()).to.equal(3);
    });

    it("should revert if non-writer anchors", async function () {
      const { registry, other } = await loadFixture(anchoredFixture);

      const sealHash = ethers.keccak256(ethers.toUtf8Bytes("hack"));

      await expect(
        registry.connect(other).anchor(sealHash)
      ).to.be.revertedWith("Unauthorized: writer only");
    });

    it("should revert anchoring a zero hash", async function () {
      const { registry, writer } = await loadFixture(anchoredFixture);

      const zeroHash = ethers.ZeroHash;
      await expect(
        registry.connect(writer).anchor(zeroHash)
      ).to.be.revertedWith("Invalid sealHash");
    });

    it("should revert anchoring the same sealHash twice (anti-doublon)", async function () {
      const { registry, writer } = await loadFixture(anchoredFixture);

      const sealHash = ethers.keccak256(ethers.toUtf8Bytes("document"));

      await registry.connect(writer).anchor(sealHash);

      await expect(
        registry.connect(writer).anchor(sealHash)
      ).to.be.revertedWith("Seal hash already anchored");
    });

    it("should record the correct writer (msg.sender)", async function () {
      const { registry, writer } = await loadFixture(anchoredFixture);

      const sealHash = ethers.keccak256(ethers.toUtf8Bytes("provenance"));
      await registry.connect(writer).anchor(sealHash);

      const [, recordedWriter] = await registry.getAnchor(0);
      expect(recordedWriter).to.equal(writer.address);
    });

    it("should record block.timestamp", async function () {
      const { registry, writer } = await loadFixture(anchoredFixture);

      const sealHash = ethers.keccak256(ethers.toUtf8Bytes("timestamp-test"));
      await registry.connect(writer).anchor(sealHash);

      const [, , ts] = await registry.getAnchor(0);
      expect(ts).to.be.a("bigint");
      expect(ts).to.be.greaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Reading anchors
  // ---------------------------------------------------------------------------

  describe("Reading anchors", function () {
    it("should return the stored anchor fields", async function () {
      const { registry, admin, writer } = await loadFixture(deployFixture);

      await registry.connect(admin).addWriter(writer.address);

      const sealHash = ethers.keccak256(ethers.toUtf8Bytes("facture-42"));
      await registry.connect(writer).anchor(sealHash);

      const [storedHash, storedWriter, storedTs] = await registry.getAnchor(0);

      expect(storedHash).to.equal(sealHash);
      expect(storedWriter).to.equal(writer.address);
      expect(storedTs).to.be.a("bigint");
    });

    it("should revert reading a non-existent index", async function () {
      const { registry } = await loadFixture(deployFixture);

      await expect(registry.getAnchor(0)).to.be.revertedWith(
        "Anchor not found"
      );
    });

    it("should be readable by anyone (no auth required)", async function () {
      const { registry, admin, writer, other } = await loadFixture(
        deployFixture
      );

      await registry.connect(admin).addWriter(writer.address);
      const sealHash = ethers.keccak256(ethers.toUtf8Bytes("public"));
      await registry.connect(writer).anchor(sealHash);

      const [h] = await registry.connect(other).getAnchor(0);
      expect(h).to.equal(sealHash);
    });
  });

  // ---------------------------------------------------------------------------
  // Admin transfer
  // ---------------------------------------------------------------------------

  describe("Admin transfer", function () {
    it("should transfer admin rights", async function () {
      const { registry, admin, newAdmin } = await loadFixture(deployFixture);

      await expect(registry.connect(admin).transferAdmin(newAdmin.address))
        .to.emit(registry, "AdminTransferred")
        .withArgs(admin.address, newAdmin.address);

      expect(await registry.admin()).to.equal(newAdmin.address);
    });

    it("should lose old admin rights after transfer", async function () {
      const { registry, admin, newAdmin, writer } = await loadFixture(
        deployFixture
      );

      await registry.connect(admin).transferAdmin(newAdmin.address);

      await expect(
        registry.connect(admin).addWriter(writer.address)
      ).to.be.revertedWith("Unauthorized: admin only");
    });

    it("should allow new admin to manage writers", async function () {
      const { registry, admin, newAdmin, writer } = await loadFixture(
        deployFixture
      );

      await registry.connect(admin).transferAdmin(newAdmin.address);

      await expect(
        registry.connect(newAdmin).addWriter(writer.address)
      ).to.emit(registry, "WriterAdded");
    });

    it("should revert transfer to zero address", async function () {
      const { registry, admin } = await loadFixture(deployFixture);

      await expect(
        registry.connect(admin).transferAdmin(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid admin");
    });
  });

  // ---------------------------------------------------------------------------
  // Revocation is non-retroactive
  // ---------------------------------------------------------------------------

  describe("Non-retroactive revocation", function () {
    it("should keep historical anchors after writer removal", async function () {
      const { registry, admin, writer } = await loadFixture(deployFixture);

      await registry.connect(admin).addWriter(writer.address);

      const sealHash = ethers.keccak256(ethers.toUtf8Bytes("historical"));
      await registry.connect(writer).anchor(sealHash);

      await registry.connect(admin).removeWriter(writer.address);

      const [storedHash, storedWriter] = await registry.getAnchor(0);
      expect(storedHash).to.equal(sealHash);
      expect(storedWriter).to.equal(writer.address);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("Edge cases", function () {
    it("should handle multiple writers independently", async function () {
      const { registry, admin } = await loadFixture(deployFixture);

      const [, writerA, writerB] = await ethers.getSigners();

      await registry.connect(admin).addWriter(writerA.address);
      await registry.connect(admin).addWriter(writerB.address);

      const hA = ethers.keccak256(ethers.toUtf8Bytes("A"));
      const hB = ethers.keccak256(ethers.toUtf8Bytes("B"));

      await registry.connect(writerA).anchor(hA);
      await registry.connect(writerB).anchor(hB);

      const [hash0, addr0] = await registry.getAnchor(0);
      const [hash1, addr1] = await registry.getAnchor(1);

      expect(hash0).to.equal(hA);
      expect(addr0).to.equal(writerA.address);
      expect(hash1).to.equal(hB);
      expect(addr1).to.equal(writerB.address);
      expect(await registry.anchorCount()).to.equal(2);
    });
  });
});
