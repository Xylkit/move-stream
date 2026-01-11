import { useState, useEffect } from "react";
import { CodeBlock } from "@/components/molecules/code-block";

export const DripsDocumentation = () => {
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set(prev).add(entry.target.id));
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -100px 0px" }
    );

    const sections = document.querySelectorAll("section[id]");
    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="prose prose-invert max-w-none">
      {/* Introduction Section */}
      <section
        id="introduction"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("introduction")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Introduction</h1>
        
        <p className="text-gray-300 text-lg mb-6">
          Xylkit is a protocol built on Movement/Aptos that enables flexible token streaming and splitting, 
          with built-in <em>dependency splitting</em> capabilities.
        </p>

        <h2 className="text-2xl font-semibold mb-4">How funds flow on Xylkit</h2>
        <p className="text-gray-300 mb-4">
          On Xylkit, anyone can set up continuous streams of any Fungible Asset (FA) to multiple recipients. 
          Recipients can configure their own splits to automatically forward a percentage of their earnings 
          to others. Over time, this creates a <em>dependency tree</em>, ensuring that even deeply-nested 
          dependencies receive a portion of funds.
        </p>

        <h3 className="text-xl font-semibold mb-3 mt-8">Streaming to your dependencies</h3>
        <p className="text-gray-300 mb-4">
          Individuals and organizations can stream funds to up to 100 recipients, each assigned a specific 
          streaming rate. Streams can be configured to start immediately or scheduled for the future, and 
          can be altered or stopped at any point.
        </p>

        <h3 className="text-xl font-semibold mb-3 mt-8">Receiving and splitting funds</h3>
        <p className="text-gray-300 mb-4">
          Any account can receive funds at any time. Recipients can configure up to 200 <em>splits receivers</em>, 
          and any funds coming in are automatically distributed accordingly. This includes both direct recipients 
          (addresses that should receive funds) and dependencies (other accounts that should receive a share).
        </p>
      </section>

      {/* Getting Started Section */}
      <section
        id="getting-started"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("getting-started")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Getting Started</h1>
        
        <p className="text-gray-300 text-lg mb-6">
          Ready to start using Xylkit? Here's how to interact with the protocol.
        </p>

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-6 py-1 my-6">
          <p className="text-blue-300 font-semibold mb-2">📝 No SDK Yet</p>
          <p className="text-gray-300">
            We don't have a JavaScript/TypeScript SDK yet. For now, check out the{" "}
            <code className="bg-gray-800 px-2 py-1 rounded">test.ts</code> file in the docs app for 
            examples of how to interact with the contracts directly. An SDK is coming soon!
          </p>
        </div>

        <h2 className="text-2xl font-semibold mb-4 mt-8">Contract Addresses</h2>
        <p className="text-gray-300 mb-4">
          The Xylkit contracts are deployed under the <code>xylkstream</code> module address. Key modules:
        </p>

        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li><code>xylkstream::drips</code> - Core protocol logic</li>
          <li><code>xylkstream::streams</code> - Streaming implementation</li>
          <li><code>xylkstream::splits</code> - Splitting implementation</li>
          <li><code>xylkstream::address_driver</code> - Address-based accounts</li>
          <li><code>xylkstream::nft_driver</code> - NFT-based accounts</li>
        </ul>

        <h2 className="text-2xl font-semibold mb-4 mt-8">Quick Example</h2>
        <p className="text-gray-300 mb-4">
          Here's a basic flow for streaming tokens:
        </p>

        <CodeBlock
          id="quick-example"
          language="typescript"
          title="Basic Streaming Flow (TypeScript)"
          code={`// See test.ts for full examples

// 1. Calculate receiver's account ID
const receiverAccountId = calcAccountId(receiverAddress);

// 2. Set up stream receivers
const newReceivers = {
  account_ids: [receiverAccountId],
  stream_ids: [1n],
  amt_per_secs: [1_000_000_000n], // 1 token unit per second
  starts: [0n],                   // Start immediately
  durations: [0n]                 // Stream forever
};

// 3. Call set_streams with positive balance_delta to fund
await addressDriver.set_streams(
  fa_metadata,
  [], [], [], [], [],           // Empty current receivers
  balanceDelta,                 // Amount to deposit
  newReceivers.account_ids,
  newReceivers.stream_ids,
  newReceivers.amt_per_secs,
  newReceivers.starts,
  newReceivers.durations,
  0, 0,                         // No hints
  senderAddress                 // Refund address
);`}
        />
      </section>

      {/* Overview Section */}
      <section
        id="overview"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("overview")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Overview</h1>
        
        <p className="text-gray-300 text-lg mb-6">
          Xylkit is a fully decentralized, non-custodial, autonomous, and gas-optimized protocol allowing you 
          to schedule and structure your Fungible Asset transactions on Movement/Aptos.
        </p>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-6 py-1 my-6">
          <p className="text-yellow-300 font-semibold mb-2">⚠️ Experimental Software</p>
          <p className="text-gray-300 text-sm">
            Xylkit is experimental software. The protocol operates in a fully decentralized and autonomous manner. 
            No entity controls or is responsible for the ongoing operation of the protocol, nor does any entity 
            have custody of funds. You are solely responsible for any interaction with the protocol. The software 
            is available on an "as-is" basis with no warranties. Use at your own risk.
          </p>
        </div>

        <p className="text-gray-300 mb-6">
          There are three ways in which funds can flow in Xylkit:
        </p>

        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-500/10 to-transparent border-l-4 border-blue-500 px-6 py-1">
            <h3 className="text-xl font-semibold mb-3 text-blue-400">Streaming</h3>
            <p className="text-gray-300">
              Moving funds between accounts over a period of time at a fixed per-second rate.
            </p>
          </div>

          <div className="bg-gradient-to-r from-green-500/10 to-transparent border-l-4 border-green-500 px-6 py-1">
            <h3 className="text-xl font-semibold mb-3 text-green-400">Giving</h3>
            <p className="text-gray-300">
              Transferring an amount of funds between accounts immediately.
            </p>
          </div>

          <div className="bg-gradient-to-r from-purple-500/10 to-transparent border-l-4 border-purple-500 px-6 py-1">
            <h3 className="text-xl font-semibold mb-3 text-purple-400">Splitting</h3>
            <p className="text-gray-300">
              Transferring a fixed fraction of funds received by one account to another account.
            </p>
          </div>
        </div>

        <h2 className="text-2xl font-semibold mb-4 mt-12">Streaming</h2>
        <p className="text-gray-300 mb-4">
          The streaming functionality sends funds over a period of time. To start streaming you need to configure 
          a list of stream receivers and top up your streamable balance. Once configured, funds flow automatically 
          and stop when the balance runs out.
        </p>

        <CodeBlock
          id="streaming-config-example"
          language="move"
          title="Streaming with AddressDriver"
          code={`// Set up streams using the address_driver module
// Each receiver gets a specific amt_per_sec (with 9 extra decimals)

public entry fun set_streams(
    caller: &signer,
    fa_metadata: address,           // Fungible Asset metadata address
    curr_receiver_account_ids: vector<u256>,
    curr_receiver_stream_ids: vector<u64>,
    curr_receiver_amt_per_secs: vector<u256>,
    curr_receiver_starts: vector<u64>,
    curr_receiver_durations: vector<u64>,
    balance_delta_bits: u128,       // Positive to add, negative to remove
    new_receiver_account_ids: vector<u256>,
    new_receiver_stream_ids: vector<u64>,
    new_receiver_amt_per_secs: vector<u256>,
    new_receiver_starts: vector<u64>,
    new_receiver_durations: vector<u64>,
    max_end_hint1: u64,
    max_end_hint2: u64,
    transfer_to: address
)`}
        />

        <h2 className="text-2xl font-semibold mb-4 mt-12">Giving</h2>
        <p className="text-gray-300 mb-4">
          The Giving functionality transfers tokens to another account immediately. It's a one-time operation 
          with no streaming configuration involved.
        </p>

        <CodeBlock
          id="giving-example"
          language="move"
          title="Give Tokens"
          code={`// Give tokens immediately to a receiver
public entry fun give(
    caller: &signer,
    receiver: u256,          // Receiver's account ID
    fa_metadata: address,    // Fungible Asset metadata address
    amt: u128                // Amount to give
)`}
        />

        <h2 className="text-2xl font-semibold mb-4 mt-12">Splitting</h2>
        <p className="text-gray-300 mb-4">
          The Splitting functionality divides received funds and transfers them to other accounts. Each account 
          has a single splits configuration that applies to all token types.
        </p>

        <CodeBlock
          id="splitting-config-example"
          language="move"
          title="Splitting Configuration"
          code={`// Set splits configuration (0-200 receivers allowed)
// Weight is out of 1_000_000 (100%)

public entry fun set_splits(
    caller: &signer,
    receiver_account_ids: vector<u256>,
    receiver_weights: vector<u32>    // Each weight / 1_000_000 = percentage
)

// Example weights:
// 500_000 = 50%
// 300_000 = 30%
// 200_000 = 20%
// Total must be <= 1_000_000`}
        />

        <h2 className="text-2xl font-semibold mb-4 mt-12">Receiving Flow</h2>
        <p className="text-gray-300 mb-4">
          Received funds go through a few steps before they can be collected:
        </p>

        <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-6 py-1 my-6">
          <ol className="list-decimal list-inside text-gray-300 space-y-3">
            <li><strong>Receiving streams</strong> - Gathers funds streamed to you from finished cycles</li>
            <li><strong>Squeezing streams</strong> - Gets funds streamed during the current (unfinished) cycle</li>
            <li><strong>Splitting</strong> - Distributes received funds according to your splits configuration</li>
            <li><strong>Collecting</strong> - Transfers funds out of the protocol to your wallet</li>
          </ol>
        </div>

        <CodeBlock
          id="receive-flow-example"
          language="move"
          title="Receiving Flow"
          code={`// 1. Receive streams from completed cycles (anyone can call)
public entry fun receive_streams(
    account_id: u256,
    fa_metadata: address,
    max_cycles: u64
)

// 2. Squeeze streams from current cycle (anyone can call)
public entry fun squeeze_streams(
    account_id: u256,
    fa_metadata: address,
    sender_id: u256,
    history_hash: vector<u8>,
    // ... history parameters
)

// 3. Split funds according to configuration (anyone can call)
public entry fun split(
    account_id: u256,
    fa_metadata: address,
    receiver_account_ids: vector<u256>,
    receiver_weights: vector<u32>
)

// 4. Collect funds to your wallet
public entry fun collect(
    caller: &signer,
    fa_metadata: address,
    transfer_to: address
)`}
        />

        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-6 py-1 my-8">
          <p className="text-green-300 font-semibold mb-2">✨ Autonomous Flow</p>
          <p className="text-gray-300">
            Receiving streams, squeezing streams, and splitting can be called by anyone for any account. 
            This creates an efficient system where funds are never stuck and can always be pushed to keep 
            flowing through the network of splits.
          </p>
        </div>
      </section>

      {/* Accounts in Xylkit Section */}
      <section
        id="accounts"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("accounts")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Accounts in Xylkit</h1>
        
        <p className="text-gray-300 text-lg mb-6">
          Xylkit uses a driver-based account model that enables different types of accounts to exchange 
          funds with one another.
        </p>

        <h2 className="text-2xl font-semibold mb-4">Background</h2>
        <p className="text-gray-300 mb-4">
          End-users can choose to stream or split funds from an account directly associated with their 
          wallet address, or create NFT-based accounts that each have their own separate balance and 
          configurations.
        </p>

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-6 py-1 my-6">
          <p className="text-blue-300 font-semibold mb-2">Key Points:</p>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>Multiple types of accounts can control funds: wallet addresses and NFT-based accounts</li>
            <li>This is enabled by an extensible system of "account drivers" implemented as Move modules</li>
            <li>The driver model makes it easy to add new account types in the future</li>
          </ul>
        </div>

        <h2 className="text-2xl font-semibold mb-4 mt-8">Account IDs</h2>
        <p className="text-gray-300 mb-4">
          Every account in Xylkit has a unique 256-bit account ID. The format depends on the driver:
        </p>
        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li><strong>AddressDriver</strong>: Your wallet address converted directly to a 256-bit number — simple and fully reversible</li>
          <li><strong>NFTDriver</strong>: Combines the minter's address (160 bits) with a unique salt (64 bits)</li>
        </ul>

        <CodeBlock
          id="account-id-example"
          language="move"
          title="Account ID Structure"
          code={`// AddressDriver: address converted directly to u256
// This allows easy recovery of the original address
public fun calc_account_id(addr: address): u256 {
    addr_to_u256(addr)
}

// NFTDriver: minter address (160 bits) | salt (64 bits)
// Each minter can create unique accounts using different salts
fun calc_token_id_internal(minter: address, salt: u64): u256 {
    let minter_bits = addr_to_u256(minter) & MINTER_MASK;
    (minter_bits << 64) | (salt as u256)
}`}
        />

        <h2 className="text-2xl font-semibold mb-4 mt-8">Account Drivers</h2>
        <p className="text-gray-300 mb-4">
          Each driver is responsible for managing a range of account IDs and authenticating actions on those accounts.
        </p>

        <h3 className="text-xl font-semibold mb-3 mt-6">AddressDriver</h3>
        <p className="text-gray-300 mb-4">
          Enables each wallet address to manage a unique account in Xylkit. No registration required — 
          any address can start using Xylkit immediately. Your account ID is simply your address as a number,
          making it easy to look up accounts and recover addresses from IDs.
        </p>

        <CodeBlock
          id="address-driver-example"
          language="move"
          title="AddressDriver Usage"
          code={`module xylkstream::address_driver {
    /// Calculates account ID - just the address as u256
    public fun calc_account_id(addr: address): u256 {
        addr_to_u256(addr)
    }
    
    /// Collects funds and transfers to specified address
    public entry fun collect(
        caller: &signer,
        fa_metadata: address,
        transfer_to: address
    )
    
    /// Gives funds from caller to receiver
    public entry fun give(
        caller: &signer,
        receiver: u256,
        fa_metadata: address,
        amt: u128
    )
    
    /// Sets the caller's streams configuration
    public entry fun set_streams(...)
    
    /// Sets the caller's splits configuration
    public entry fun set_splits(
        caller: &signer,
        receiver_account_ids: vector<u256>,
        receiver_weights: vector<u32>
    )
}`}
        />

        <h3 className="text-xl font-semibold mb-3 mt-8">NFTDriver</h3>
        <p className="text-gray-300 mb-4">
          Allows users to create unlimited NFT-based accounts, each with its own balance and streaming settings. 
          Only the NFT holder can control the associated account. Token IDs combine the minter's address with a 
          salt, ensuring uniqueness while allowing deterministic ID calculation.
        </p>

        <CodeBlock
          id="nft-driver-example"
          language="move"
          title="NFTDriver Usage"
          code={`module xylkstream::nft_driver {
    /// Token ID = minter (160 bits) | salt (64 bits)
    public fun calc_token_id_with_salt(minter: address, salt: u64): u256
    
    /// Mints a new token controlling a new account ID
    public entry fun mint(
        caller: &signer,
        to: address,
        metadata_keys: vector<vector<u8>>,
        metadata_values: vector<vector<u8>>
    )
    
    /// Mints with deterministic token ID based on caller + salt
    public entry fun mint_with_salt(
        caller: &signer,
        salt: u64,
        to: address,
        metadata_keys: vector<vector<u8>>,
        metadata_values: vector<vector<u8>>
    )
    
    /// Burns the token, freezing the account permanently
    public entry fun burn(caller: &signer, token_id: u256)
    
    /// All drips operations require token ownership
    public entry fun collect(caller: &signer, token_id: u256, ...)
    public entry fun give(caller: &signer, token_id: u256, ...)
    public entry fun set_streams(caller: &signer, token_id: u256, ...)
    public entry fun set_splits(caller: &signer, token_id: u256, ...)
}`}
        />

        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-6 py-1 my-6">
          <p className="text-purple-300 font-semibold mb-2">🔌 Extensible Architecture</p>
          <p className="text-gray-300">
            The driver model makes it straightforward to add new account types. Future drivers could enable 
            accounts controlled by multisigs, DAOs, or other on-chain entities. Each driver just needs to 
            implement the authentication logic and call into the core Xylkit modules.
          </p>
          <p className="text-gray-300 mt-2 text-sm">
            <strong>Note for developers:</strong> When creating new drivers, carefully design your account ID 
            structure to avoid collisions with existing drivers. AddressDriver uses full 256-bit addresses, 
            while NFTDriver uses a 160-bit minter + 64-bit salt layout. New drivers should use distinct bit 
            patterns or reserved ranges to ensure account IDs remain globally unique.
          </p>
        </div>
      </section>

      {/* Account Metadata Section */}
      <section
        id="account-metadata"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("account-metadata")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Account Metadata</h1>
        
        <p className="text-gray-300 mb-4">
          Xylkit includes functionality for associating general metadata with accounts. The authority to add 
          metadata rests with the account owner, and apps can build on this capability to store any kind of 
          metadata they need.
        </p>

        <h2 className="text-2xl font-semibold mb-4 mt-8">Use Cases</h2>
        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li>Marking an NFT-based account as "associated" with a specific application</li>
          <li>Attaching profile information to an account (name, avatar URL, etc.)</li>
          <li>Attaching descriptive information to streams and splits configurations</li>
        </ul>

        <h2 className="text-2xl font-semibold mb-4 mt-8">Emitting Metadata</h2>
        <p className="text-gray-300 mb-4">
          Metadata is emitted as events that can be indexed off-chain. The keys and values are not standardized 
          by the protocol — it's up to users to establish conventions.
        </p>

        <CodeBlock
          id="emit-metadata-example"
          language="move"
          title="Emit Account Metadata"
          code={`// Emit metadata for an address-based account
public entry fun emit_account_metadata(
    caller: &signer,
    keys: vector<vector<u8>>,
    values: vector<vector<u8>>
)

// Emit metadata for an NFT-based account
public entry fun emit_account_metadata(
    caller: &signer,
    token_id: u256,
    keys: vector<vector<u8>>,
    values: vector<vector<u8>>
)

// Event structure
struct AccountMetadataEmitted has drop, store {
    account_id: u256,
    key: vector<u8>,
    value: vector<u8>
}`}
        />
      </section>

      {/* Inner Workings Section */}
      <section
        id="inner-workings"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("inner-workings")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Inner Workings</h1>
        
        <p className="text-gray-300 text-lg mb-6">
          This section explains the core mechanics of how streaming is implemented in Xylkit's Move contracts.
        </p>

        <h2 className="text-2xl font-semibold mb-4">Design Principles</h2>
        <p className="text-gray-300 mb-4">
          Xylkit allows users to set up and manage continuous transfers of funds from one account to another 
          over time. Tokens are not sent directly to recipients — instead, the contract tracks balances and 
          allows receivers to collect funds when they wish.
        </p>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-6 py-1 my-6">
          <p className="text-yellow-300 font-semibold mb-2">Gas Efficiency</p>
          <p className="text-gray-300">
            Xylkit is designed to be gas-efficient even with many senders streaming to a single receiver. 
            Instead of storing individual stream details, the protocol uses <strong>cycles</strong> and 
            <strong>deltas</strong> to aggregate funds efficiently.
          </p>
        </div>

        <h3 className="text-xl font-semibold mb-3 mt-8">Cycles</h3>
        <p className="text-gray-300 mb-4">
          The timeline is divided into fixed-length cycles (default: 60 seconds). All funds streamed to a 
          receiver during a cycle are aggregated together. Funds become receivable only after the cycle ends.
        </p>

        <CodeBlock
          id="cycle-example"
          language="move"
          title="Cycle Configuration"
          code={`// Default cycle length: 60 seconds
const DEFAULT_CYCLE_SECS: u64 = 60;

// Cycle calculation
fun cycle_of(ts: u64, cycle_secs: u64): u64 {
    ts / cycle_secs + 1  // Cycles start from 1
}

// Minimum streaming rate: 1 token per cycle
// min_amt_per_sec = ceil(AMT_PER_SEC_MULTIPLIER / cycle_secs)`}
        />

        <h3 className="text-xl font-semibold mb-3 mt-8">Receiver Deltas</h3>
        <p className="text-gray-300 mb-4">
          For efficiency, we store <strong>deltas</strong> (rate changes) per cycle rather than full amounts. 
          If no delta is stored for a cycle, the previous rate continues.
        </p>

        <CodeBlock
          id="delta-example"
          language="move"
          title="Delta Accounting"
          code={`// Delta amounts applied to cycles
struct AmtDelta has copy, drop, store {
    this_cycle: I128,   // Change applied at start of this cycle
    next_cycle: I128    // Change applied at start of next cycle
}

// When a stream starts mid-cycle:
// - this_cycle gets partial amount for remaining time
// - next_cycle gets adjustment to reach full rate

// When a stream ends mid-cycle:
// - Negative deltas are added to stop the flow`}
        />

        <h3 className="text-xl font-semibold mb-3 mt-8">Scheduled Streams</h3>
        <p className="text-gray-300 mb-4">
          Streams can be configured to start immediately or at a future time, and can have an optional duration.
        </p>

        <CodeBlock
          id="scheduled-example"
          language="move"
          title="Stream Configuration"
          code={`struct StreamConfig has copy, drop, store {
    stream_id: u64,      // Unique ID for this stream
    amt_per_sec: u256,   // Rate with 9 extra decimals
    start: u64,          // 0 = start immediately, else = future timestamp
    duration: u64        // 0 = forever, else = seconds to stream
}`}
        />
      </section>

      {/* Fractional Amounts Section */}
      <section
        id="fractional-amounts"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("fractional-amounts")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Fractional Amounts</h1>
        
        <h2 className="text-2xl font-semibold mb-4">Token Decimals</h2>
        <p className="text-gray-300 mb-4">
          Tokens in Move are indivisible at the smart contract level. What appears as "2.5 tokens" is actually 
          stored as a larger integer with decimal places applied for display. For example, a token with 8 decimals 
          stores 2.5 as 250,000,000.
        </p>

        <h2 className="text-2xl font-semibold mb-4 mt-8">Sub-Token Precision</h2>
        <p className="text-gray-300 mb-4">
          Streaming rates (<code>amt_per_sec</code>) have <strong>9 extra decimals</strong> for sub-token precision. 
          This allows expressing rates smaller than 1 token unit per second.
        </p>

        <CodeBlock
          id="precision-example"
          language="move"
          title="Rate Precision"
          code={`// Additional decimals for all amt_per_sec values
const AMT_PER_SEC_EXTRA_DECIMALS: u8 = 9;
const AMT_PER_SEC_MULTIPLIER: u256 = 1_000_000_000;

// Example: Stream 1 token unit per second
// amt_per_sec = 1 * 1_000_000_000 = 1_000_000_000

// Example: Stream 0.5 token units per second
// amt_per_sec = 0.5 * 1_000_000_000 = 500_000_000

// Example: Stream 1 token per day (86400 seconds)
// amt_per_sec = 1_000_000_000 / 86400 ≈ 11_574`}
        />

        <h2 className="text-2xl font-semibold mb-4 mt-8">Whole Token Transfers</h2>
        <p className="text-gray-300 mb-4">
          Despite sub-token precision in rates, actual transfers are always whole token units. Partial amounts 
          accumulate in the sender's balance until they add up to whole units.
        </p>

        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-6 py-1 my-6">
          <p className="text-purple-300 font-semibold mb-2">Example: Streaming 1.4 tokens/second</p>
          <ul className="list-disc list-inside text-gray-300 space-y-1">
            <li>Second 1: 1 token moved, 0.4 remains with sender</li>
            <li>Second 2: 1 token moved, 0.8 remains with sender</li>
            <li>Second 3: 2 tokens moved, 0.2 remains with sender</li>
          </ul>
        </div>

        <h2 className="text-2xl font-semibold mb-4 mt-8">Minimum Rate</h2>
        <p className="text-gray-300 mb-4">
          The minimum valid streaming rate is 1 token unit per cycle. Rates lower than this would result in 
          no token movement and are rejected.
        </p>

        <CodeBlock
          id="min-rate-example"
          language="move"
          title="Minimum Rate Calculation"
          code={`// Minimum amt_per_sec = ceil(AMT_PER_SEC_MULTIPLIER / cycle_secs)
// With 60-second cycles:
// min_amt_per_sec = ceil(1_000_000_000 / 60) = 16_666_667

// This ensures at least 1 token unit moves per cycle`}
        />
      </section>

      {/* Xylkit Features Section */}
      <section
        id="features"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("features")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Xylkit Features</h1>
        
        <p className="text-gray-300 text-lg mb-6">
          Xylkit brings powerful streaming and splitting capabilities to the Move ecosystem with these key features:
        </p>

        <div className="grid md:grid-cols-2 gap-6 mt-8">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">Any Fungible Asset</h3>
            <p className="text-gray-300 text-sm">
              Stream any Fungible Asset (FA) on Movement/Aptos. No wrapped tokens required.
            </p>
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">Gas-Optimized</h3>
            <p className="text-gray-300 text-sm">
              Efficient delta-based accounting supports many-to-one streaming at scale.
            </p>
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">Scheduled Streams</h3>
            <p className="text-gray-300 text-sm">
              Schedule streams to start and end at specific times in the future.
            </p>
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">Shared Balances</h3>
            <p className="text-gray-300 text-sm">
              Fund multiple streams from a single balance with one transaction.
            </p>
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">Flexible Identity</h3>
            <p className="text-gray-300 text-sm">
              Use wallet addresses directly or create NFT-based accounts for more control.
            </p>
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">Unified Protocol</h3>
            <p className="text-gray-300 text-sm">
              One set of contracts for streaming and splitting, enabling flexible token routing.
            </p>
          </div>
        </div>
      </section>

      {/* Credits Section */}
      <section
        id="credits"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("credits")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">Credits</h1>
        
        <p className="text-gray-300 text-lg mb-6">
          Xylkit is inspired by and built upon the concepts pioneered by the{" "}
          <a 
            href="https://drips.network" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-blue-400 hover:underline"
          >
            Drips Protocol
          </a>
          , a groundbreaking streaming and splitting protocol originally built on Ethereum.
        </p>

        <p className="text-gray-300 mb-4">
          We've adapted and reimplemented the core concepts for the Move ecosystem, bringing powerful 
          token streaming capabilities to Movement and Aptos. While the fundamental mechanics remain 
          similar, Xylkit is optimized for Move's resource-oriented programming model and works 
          natively with Fungible Assets (FA).
        </p>

        <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg px-6 py-1 my-6">
          <p className="text-purple-300 font-semibold mb-2">🙏 Special Thanks</p>
          <p className="text-gray-300">
            Special thanks to the Drips team for their innovative work on decentralized streaming infrastructure. 
            Learn more about the original protocol at{" "}
            <a 
              href="https://docs.drips.network" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-blue-400 hover:underline"
            >
              docs.drips.network
            </a>
          </p>
        </div>
      </section>

      {/* FAQ Section - Now at the bottom */}
      <section
        id="faq"
        className={`pb-16 transition-all duration-700 ${
          visibleSections.has("faq")
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <h1 className="text-4xl font-bold mb-8">FAQ</h1>
        
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold mb-3">Are there fees for using Xylkit?</h3>
            <p className="text-gray-300">
              The Xylkit Protocol is free to use and does not impose any fees on users. Users will still need to pay gas
              fees to interact with the contracts as they would with any contract on Movement/Aptos.
            </p>
            <p className="text-gray-300 mt-2">
              Third-party apps building on Xylkit may choose to impose fees of their own.
            </p>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">Can I split or stream funds directly to exchange-managed addresses?</h3>
            <p className="text-gray-300">
              No. When an address receives funds on Xylkit, the owner of that address needs to <em>collect</em> them 
              before they are transferred to their wallet. Exchanges typically offer custodial addresses that don't 
              allow signing contract interactions. Funds sent to such addresses may be unrecoverable. Only split or 
              stream funds to self-custodial wallets.
            </p>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">Do I need MOVE/APT to send or receive tokens?</h3>
            <p className="text-gray-300">
              Users need the native gas token (MOVE on Movement, APT on Aptos) to cover transaction fees when creating 
              streams or splits. You don't need gas to receive funds, but you will need some when you're ready to 
              collect them.
            </p>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">What happens to unclaimed funds?</h3>
            <p className="text-gray-300">
              Funds that have been streamed but not collected remain in the protocol waiting for the recipient to 
              claim them. There is currently no expiration on unclaimed funds.
            </p>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">How do cycles work?</h3>
            <p className="text-gray-300">
              The timeline is divided into fixed-length cycles (default: 60 seconds). Funds streamed during a cycle 
              become receivable only after the cycle ends. This aggregation makes receiving from many senders 
              gas-efficient. You can also "squeeze" funds from the current cycle if you need them immediately, 
              though this costs more gas.
            </p>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">Can I update or cancel streams?</h3>
            <p className="text-gray-300">
              Yes, you can update your streams configuration at any time. However, you can only change streams for 
              the future — funds already streamed in the past cannot be recovered. When you update, any unstreamed 
              balance can be withdrawn.
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-16 pt-8 border-t border-gray-800 text-center text-gray-500 text-sm">
        <p>Xylkit Protocol Documentation</p>
        <p className="mt-2">
          <a 
            href="https://github.com/kelvinpraises/xylkit" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-blue-400 hover:underline"
          >
            GitHub Repository
          </a>
          {" · "}
          <a 
            href="https://drips.network" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-blue-400 hover:underline"
          >
            Inspired by Drips Protocol
          </a>
        </p>
      </footer>
    </div>
  );
};
