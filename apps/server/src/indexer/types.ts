// Movement event types
export interface MovementEvent {
  version: string;
  sequence_number: string;
  type: string;
  data: Record<string, unknown>;
  tx_hash?: string;
  timestamp?: string;
  sender?: string; // Transaction sender address
  entry_function?: string; // Entry function like "0x123::address_driver::set_streams"
  guid?: {
    creation_number: string;
    account_address: string;
  };
}

// Contract event data structures
export interface StreamsSetEventData {
  account_id: string;
  fa_metadata: string;
  receiver_account_ids: string[];
  receiver_stream_ids: string[];
  receiver_amt_per_secs: string[];
  receiver_starts: string[];
  receiver_durations: string[];
  balance: string;
  max_end: string;
}

export interface SplitsSetEventData {
  account_id: string;
  receiver_account_ids: string[];
  receiver_weights: string[];
}

export interface GivenEventData {
  account_id: string;
  receiver_id: string;
  fa_metadata: string;
  amount: string;
}

export interface ReceivedEventData {
  account_id: string;
  fa_metadata: string;
  amount: string;
}

export interface SqueezedEventData {
  account_id: string;
  sender_id: string;
  fa_metadata: string;
  amount: string;
}

export interface SplitExecutedEventData {
  account_id: string;
  fa_metadata: string;
  to_receivers: string;
  to_self: string;
}

export interface CollectedEventData {
  account_id: string;
  fa_metadata: string;
  amount: string;
}
