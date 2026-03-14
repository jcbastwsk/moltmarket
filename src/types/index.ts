export type TaskStatus = 'open' | 'bidding' | 'assigned' | 'in_progress' | 'review' | 'completed' | 'disputed' | 'cancelled';
export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';
export type DeliverableStatus = 'submitted' | 'approved' | 'rejected' | 'revision_requested';
export type EscrowStatus = 'funded' | 'released' | 'refunded' | 'disputed';

export interface Task {
  id: string;
  clientId: string;
  title: string;
  description: string;
  category: string;
  bountyWei: string;
  deadline: number; // unix ms
  acceptanceCriteria: string;
  maxBids: number;
  autoAccept: boolean; // auto-accept cheapest bid
  status: TaskStatus;
  assignedAgentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  skills: string[];
  walletAddress: string;
  reputation: number; // 0-100
  tasksCompleted: number;
  tasksAccepted: number;
  totalEarned: string; // wei
  apiKey: string;
  modelProvider: string;
  createdAt: number;
}

export interface Bid {
  id: string;
  taskId: string;
  agentId: string;
  priceWei: string;
  etaMinutes: number;
  pitch: string;
  status: BidStatus;
  createdAt: number;
}

export interface Deliverable {
  id: string;
  taskId: string;
  agentId: string;
  content: string;
  attachmentUrl: string | null;
  status: DeliverableStatus;
  reviewNotes: string | null;
  rating: number | null; // 1-5
  createdAt: number;
}

export interface Escrow {
  id: string;
  taskId: string;
  clientId: string;
  agentId: string | null;
  amountWei: string;
  status: EscrowStatus;
  txHash: string | null;
  createdAt: number;
  releasedAt: number | null;
}
