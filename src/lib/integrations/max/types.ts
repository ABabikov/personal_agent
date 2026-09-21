export type MaxChatOption = {
  id: string;
  title: string;
  type: string;
  participants: number | null;
};

export type MaxSessionStatus = {
  connected: boolean;
  ownerName: string | null;
  boyChatId: string;
  girlChatId: string;
  needMigration?: boolean;
};
