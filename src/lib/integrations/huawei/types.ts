/** Subset of Huawei Health Kit activity record REST response (v2). */
export type HuaweiActivityRecord = {
  id: string;
  startTime: number;
  endTime?: number;
  activityType?: string | number;
  activityTypeId?: string;
  name?: string;
  activeTimeMillis?: number;
  activitySummary?: {
    dataSummary?: HuaweiDataSummaryItem[];
  };
};

export type HuaweiDataSummaryItem = {
  dataTypeName?: string;
  value?: Array<{
    floatValue?: number;
    intValue?: number;
    fieldName?: string;
  }>;
};

export type HuaweiActivityRecordsResponse = {
  activityRecord?: HuaweiActivityRecord[];
  pageCount?: number;
  continueToken?: string;
};

export type HuaweiTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

export type MappedActivityType = "gym" | "swim" | "other";

export type DeviceSessionUpsert = {
  external_id: string;
  started_at: string;
  ended_at: string | null;
  activity_type_raw: string | null;
  activity_type_mapped: MappedActivityType;
  calories_device: number | null;
  avg_heart_rate: number | null;
  duration_seconds: number | null;
  payload: Record<string, unknown> | null;
};
