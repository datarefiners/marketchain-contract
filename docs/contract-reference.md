# MarketChainAnchorRegistry — Référence contrat

## Déploiement

```js
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0x0Cc3fF130dc4D96F0d250a1E3680EeAA53C31bc7"; // Amoy

// Provider (lecture seule)
const provider = new ethers.JsonRpcProvider("https://polygon-amoy-bor-rpc.publicnode.com");

// Signer (lecture + écriture)
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Instance contrat
const registry = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
```

## Fonctions

### `anchor(bytes32 sealHash)`

Ancre un hash dans le registre. Appelable uniquement par un wallet autorisé (`writers[msg.sender] == true`).

| | |
|---|---|
| **Qui** | Un `writer` (pas forcément l'admin) |
| **Paramètre** | `sealHash` — `bytes32`, le Marketchain Hash 2.1 |
| **Return** | Rien |
| **Revert si** | `msg.sender` n'est pas writer, `sealHash == 0`, ou sealHash déjà ancré |
| **Event** | `AnchorCreated(uint256 index, bytes32 sealHash, address writer, uint256 timestamp)` |

```js
// Node.js
const sealHash = ethers.keccak256(ethers.toUtf8Bytes(payload));
const tx = await registry.connect(userWallet).anchor(sealHash);
const receipt = await tx.wait();

// Récupérer l'index depuis l'event
const event = receipt.logs.find((log) => {
  try { return registry.interface.parseLog(log).name === "AnchorCreated"; }
  catch { return false; }
});
const parsed = registry.interface.parseLog(event);
console.log("Index  :", parsed.args.index);
console.log("Hash   :", parsed.args.sealHash);
console.log("Writer :", parsed.args.writer);
console.log("Block  :", receipt.blockNumber);
console.log("Tx     :", receipt.hash);
```

### `addWriter(address wallet)`

Autorise un wallet à appeler `anchor()`.

| | |
|---|---|
| **Qui** | Admin uniquement |
| **Paramètre** | `wallet` — `address`, le wallet à autoriser |
| **Return** | Rien |
| **Revert si** | `msg.sender != admin`, `wallet == address(0)`, ou déjà writer |
| **Event** | `WriterAdded(address indexed wallet)` |

```js
const tx = await registry.connect(adminWallet).addWriter("0x...");
await tx.wait();
```

### `removeWriter(address wallet)`

Révoque le droit d'écriture d'un wallet. Les ancres passées restent intactes.

| | |
|---|---|
| **Qui** | Admin uniquement |
| **Paramètre** | `wallet` — `address`, le wallet à révoquer |
| **Return** | Rien |
| **Revert si** | `msg.sender != admin` ou wallet pas writer |
| **Event** | `WriterRemoved(address indexed wallet)` |

```js
const tx = await registry.connect(adminWallet).removeWriter("0x...");
await tx.wait();
```

### `getAnchor(uint256 index) → (bytes32, address, uint256)`

Lit une ancre par son index séquentiel (0-based).

| | |
|---|---|
| **Qui** | Tout le monde (view) |
| **Paramètre** | `index` — `uint256`, index de l'ancre (0 à `anchorCount - 1`) |
| **Return** | `sealHash` (`bytes32`), `writer` (`address`), `timestamp` (`uint256` Unix) |
| **Revert si** | `index >= anchorCount` |

```js
const [sealHash, writer, timestamp] = await registry.getAnchor(42);
console.log("Hash :", sealHash);
console.log("Par  :", writer);
console.log("Date :", new Date(Number(timestamp) * 1000).toISOString());
```

### `isWriter(address wallet) → bool`

Vérifie si un wallet a le droit d'écrire.

```js
const ok = await registry.isWriter("0x..."); // true | false
```

### `transferAdmin(address newAdmin)`

Transfère la gouvernance du contrat.

| | |
|---|---|
| **Qui** | Admin uniquement |
| **Paramètre** | `newAdmin` — `address` |
| **Return** | Rien |
| **Revert si** | `msg.sender != admin` ou `newAdmin == address(0)` |
| **Event** | `AdminTransferred(address indexed previousAdmin, address indexed newAdmin)` |

```js
const tx = await registry.connect(adminWallet).transferAdmin("0x...");
await tx.wait();
```

## Variables publiques (lecture directe)

```js
const admin       = await registry.admin();       // address
const count       = await registry.anchorCount(); // uint256
const isWriter    = await registry.writers("0x...");  // bool
const sealExists  = await registry.sealHashExists(hash); // bool
```

## Events

### `AnchorCreated(uint256 indexed index, bytes32 indexed sealHash, address indexed writer, uint256 timestamp)`

Émis à chaque `anchor()`. Les 3 paramètres sont indexés → filtrables.

### `WriterAdded(address indexed wallet)`

Émis quand un wallet est autorisé.

### `WriterRemoved(address indexed wallet)`

Émis quand un wallet est révoqué.

### `AdminTransferred(address indexed previousAdmin, address indexed newAdmin)`

Émis au déploiement et à chaque `transferAdmin()`.

## Écouter les events (Node.js)

```js
// En temps réel
registry.on(
  "AnchorCreated",
  (index, sealHash, writer, timestamp/* , event */) => {
    console.log(`Ancre #${index}: ${sealHash} par ${writer}`);
  }
);

// Historique (depuis le bloc X)
const filter = registry.filters.AnchorCreated();
const events = await registry.queryFilter(filter, startBlockNumber);
for (const event of events) {
  console.log(event.args.index, event.args.sealHash);
}
```

## Anti-doublon

Un même `sealHash` ne peut être ancré qu'**une seule fois**. Toute tentative de ré-ancrage revert avec `"Seal hash already anchored"`.

Avant d'ancrer côté SaaS, vérifier :

```js
const alreadyAnchored = await registry.sealHashExists(sealHash);
if (alreadyAnchored) {
  throw new Error("Ce sealHash est déjà ancré");
}
```

## Révocation non rétroactive

Quand un writer est révoqué via `removeWriter()` :
- Il ne peut **plus** ancrer de nouveaux hashes
- Ses ancres **passées** restent consultables dans `anchors[index]` avec son adresse d'origine
- `getAnchor()` continue de retourner son adresse

## Preuve complète

Pour vérifier une ancre côté SaaS, conserver :

```js
{
  index:             parsed.args.index,        // position dans le registre
  sealHash:          parsed.args.sealHash,     // le hash ancré
  writer:            parsed.args.writer,       // qui l'a ancré
  timestampOnChain:  parsed.args.timestamp,    // block.timestamp
  blockNumber:       receipt.blockNumber,      // bloc
  txHash:            receipt.hash,             // transaction
  payload:           rawPayload,               // données d'origine (off-chain)
  hashVersion:       "2.1"                     // version Marketchain Hash
}
```
