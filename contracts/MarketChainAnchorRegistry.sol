// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MarketChainAnchorRegistry {
    address public admin;
    uint256 public anchorCount;

    mapping(address => bool) public writers;
    mapping(uint256 => Anchor) public anchors;
    mapping(bytes32 => bool) public sealHashExists;

    struct Anchor {
        bytes32 sealHash;
        address writer;
        uint256 timestamp;
    }

    event AnchorCreated(
        uint256 indexed index,
        bytes32 indexed sealHash,
        address indexed writer,
        uint256 timestamp
    );

    event WriterAdded(address indexed wallet);
    event WriterRemoved(address indexed wallet);
    event AdminTransferred(
        address indexed previousAdmin,
        address indexed newAdmin
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "Unauthorized: admin only");
        _;
    }

    modifier onlyWriter() {
        require(writers[msg.sender], "Unauthorized: writer only");
        _;
    }

    constructor(address initialAdmin) {
        require(initialAdmin != address(0), "Invalid admin");
        admin = initialAdmin;
        emit AdminTransferred(address(0), initialAdmin);
    }

    function addWriter(address wallet) external onlyAdmin {
        require(wallet != address(0), "Invalid wallet");
        require(!writers[wallet], "Already writer");

        writers[wallet] = true;
        emit WriterAdded(wallet);
    }

    function removeWriter(address wallet) external onlyAdmin {
        require(writers[wallet], "Not writer");

        writers[wallet] = false;
        emit WriterRemoved(wallet);
    }

    function anchor(bytes32 sealHash) external onlyWriter {
        require(sealHash != bytes32(0), "Invalid sealHash");
        require(!sealHashExists[sealHash], "Seal hash already anchored");

        sealHashExists[sealHash] = true;

        uint256 index = anchorCount;

        anchors[index] = Anchor({
            sealHash: sealHash,
            writer: msg.sender,
            timestamp: block.timestamp
        });

        anchorCount = index + 1;

        emit AnchorCreated(index, sealHash, msg.sender, block.timestamp);
    }

    function getAnchor(uint256 index)
        external
        view
        returns (bytes32 sealHash, address writer, uint256 timestamp)
    {
        require(index < anchorCount, "Anchor not found");

        Anchor memory record = anchors[index];
        return (record.sealHash, record.writer, record.timestamp);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");

        address previousAdmin = admin;
        admin = newAdmin;

        emit AdminTransferred(previousAdmin, newAdmin);
    }
}
