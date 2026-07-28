import type { MigrationConversionArtifact, MigrationPlan, MutationCommand, RuntimeRealtimeEvent } from "@framekit/runtime";

export type PostgresRepositoryOptions = {
  connectionString: string;
  max?: number;
  onQuery?: (query: { sql: string; params: unknown[] }) => void;
};

export type PostgresMutationStage = "document" | "hooks" | "audit" | "outbox" | "idempotency";

export type PostgresMutationUnitOfWorkOptions = PostgresRepositoryOptions & {
  faultInjector?: (stage: PostgresMutationStage, command: MutationCommand) => void | Promise<void>;
};

export type PostgresMigrationStage = "statement" | "backfill" | "online_chunk" | "record";

export type PostgresMigrationStoreOptions = PostgresRepositoryOptions & {
  faultInjector?: (stage: PostgresMigrationStage, plan: MigrationPlan, statementIndex?: number) => void | Promise<void>;
  conversionRegistry?: readonly MigrationConversionArtifact[];
};

export type PostgresRealtimeStage = "locked" | "inserted";

export type PostgresRealtimePublisherOptions = PostgresRepositoryOptions & {
  faultInjector?: (stage: PostgresRealtimeStage, event: RuntimeRealtimeEvent) => void | Promise<void>;
};
