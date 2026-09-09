# Public API reference

Generated from the public TypeScript entry points by `pnpm docs:api`. This index links each public symbol to its defining source; function and constructor signatures are included where available. Package exports and their declaration files remain the complete type contract. Regenerate after changing public APIs.

## @framekit/core

### AppDefinition

[Source](../packages/core/src/schema.ts#L376)

Type alias.

### AppSchema

[Source](../packages/core/src/schema.ts#L368)

Exported value or type.

### assertPermission

[Source](../packages/core/src/policy.ts#L31)

```ts
assertPermission(context: TenantContext, doctype: DocTypeDefinition, action: DocumentAction): void
```

### AttachmentMetadata

[Source](../packages/core/src/schema.ts#L79)

Type alias.

### canTransferOwnership

[Source](../packages/core/src/policy.ts#L24)

```ts
canTransferOwnership(context: TenantContext, doctype: DocTypeDefinition): boolean
```

### ChildFieldDefinition

[Source](../packages/core/src/schema.ts#L76)

Type alias.

### ChildFieldSchema

[Source](../packages/core/src/schema.ts#L65)

Exported value or type.

### ChildRecord

[Source](../packages/core/src/schema.ts#L78)

Type alias.

### CommandDefinition

[Source](../packages/core/src/schema.ts#L281)

Type alias.

### CommandDefinitionSchema

[Source](../packages/core/src/schema.ts#L271)

Exported value or type.

### ComputedFieldSchema

[Source](../packages/core/src/schema.ts#L40)

Exported value or type.

### CustomFieldDefinition

[Source](../packages/core/src/schema.ts#L106)

Type alias.

### CustomFieldSchema

[Source](../packages/core/src/schema.ts#L99)

Exported value or type.

### decimalPrecision

[Source](../packages/core/src/schema.ts#L91)

```ts
decimalPrecision(field: Pick<FieldDefinition, "type" | "precision">): number
```

### decimalScale

[Source](../packages/core/src/schema.ts#L95)

```ts
decimalScale(field: Pick<FieldDefinition, "type" | "scale">): number
```

### defineApp

[Source](../packages/core/src/composition.ts#L36)

```ts
defineApp(definition: Omit<Partial<AppDefinition>, "modules"> & Pick<AppDefinition, "name"> & { modules?: ModuleDefinition[]; }): AppDefinition
```

### defineDocType

[Source](../packages/core/src/metadata.ts#L4)

```ts
defineDocType(definition: z.input<typeof DocTypeSchema>): DocTypeDefinition
```

### defineModule

[Source](../packages/core/src/composition.ts#L8)

```ts
defineModule(definition: Omit<Partial<ModuleDefinition>, "doctypes" | "commands" | "settings"> & Pick<ModuleDefinition, "id" | "name"> & { doctypes?: z.input<typeof DocTypeSchema>[]; commands?: z.input<typeof CommandDefinitionSchema>[]; settings?: z.input<typeof SettingDefinitionSchema>[]; }): ModuleDefinition
```

### DocTypeDefinition

[Source](../packages/core/src/schema.ts#L186)

Type alias.

### DocTypeSchema

[Source](../packages/core/src/schema.ts#L160)

Exported value or type.

### DocumentAction

[Source](../packages/core/src/schema.ts#L29)

Type alias.

### DocumentCommandCompensationSchema

[Source](../packages/core/src/schema.ts#L296)

Exported value or type.

### DocumentCommandOperation

[Source](../packages/core/src/schema.ts#L307)

Type alias.

### DocumentCommandOperationSchema

[Source](../packages/core/src/schema.ts#L297)

Exported value or type.

### DocumentCommandRequest

[Source](../packages/core/src/schema.ts#L308)

Type alias.

### DocumentCommandRequestSchema

[Source](../packages/core/src/schema.ts#L302)

Exported value or type.

### DocumentData

[Source](../packages/core/src/schema.ts#L215)

Type alias.

### DocumentHook

[Source](../packages/core/src/schema.ts#L245)

Type alias.

### DocumentRecord

[Source](../packages/core/src/schema.ts#L217)

Type alias.

### DocumentStatus

[Source](../packages/core/src/schema.ts#L30)

Type alias.

### FieldDefinition

[Source](../packages/core/src/schema.ts#L75)

Type alias.

### FieldSchema

[Source](../packages/core/src/schema.ts#L69)

Exported value or type.

### FieldType

[Source](../packages/core/src/schema.ts#L28)

Type alias.

### fieldTypes

[Source](../packages/core/src/schema.ts#L3)

Exported value or type.

### FieldValidatorSchema

[Source](../packages/core/src/schema.ts#L32)

Exported value or type.

### FramekitError

[Source](../packages/core/src/errors.ts#L1)

```ts
FramekitError(code: string, message: string, statusCode?: number, details?: unknown | undefined): FramekitError
```

### getDocType

[Source](../packages/core/src/composition.ts#L54)

```ts
getDocType(app: AppDefinition, name: string): DocTypeDefinition
```

### hasAccess

[Source](../packages/core/src/policy.ts#L4)

```ts
hasAccess(context: TenantContext, rule: PermissionRule | WorkflowTransition | RowPolicyRule): boolean
```

### hasRowAccess

[Source](../packages/core/src/policy.ts#L19)

```ts
hasRowAccess(context: TenantContext, doctype: DocTypeDefinition, operation: "read" | "write", ownerId?: string): boolean
```

### HookContext

[Source](../packages/core/src/schema.ts#L237)

Type alias.

### HookName

[Source](../packages/core/src/schema.ts#L206)

Type alias.

### HookNames

[Source](../packages/core/src/schema.ts#L188)

Exported value or type.

### listDocTypes

[Source](../packages/core/src/composition.ts#L60)

```ts
listDocTypes(app: AppDefinition): DocTypeDefinition[]
```

### listNavigation

[Source](../packages/core/src/composition.ts#L64)

```ts
listNavigation(app: AppDefinition): { label: string; path: string; order: number; labelKey?: string | undefined; icon?: string | undefined; permission?: string | undefined; }[]
```

### localeFallbackChain

[Source](../packages/core/src/localization.ts#L12)

```ts
localeFallbackChain(localization: LocalizationDefinition, requestedLocale?: string): string[]
```

### LocalizationDefinition

[Source](../packages/core/src/schema.ts#L332)

Type alias.

### LocalizationSchema

[Source](../packages/core/src/schema.ts#L325)

Exported value or type.

### ModuleDefinition

[Source](../packages/core/src/schema.ts#L351)

Type alias.

### ModuleHooks

[Source](../packages/core/src/schema.ts#L247)

Type alias.

### ModuleSchema

[Source](../packages/core/src/schema.ts#L334)

Exported value or type.

### NavigationItem

[Source](../packages/core/src/schema.ts#L269)

Type alias.

### NavigationItemSchema

[Source](../packages/core/src/schema.ts#L260)

Exported value or type.

### OwnerTransferReceipt

[Source](../packages/core/src/schema.ts#L230)

Type alias.

### PermissionRule

[Source](../packages/core/src/schema.ts#L124)

Type alias.

### PermissionRuleSchema

[Source](../packages/core/src/schema.ts#L118)

Exported value or type.

### resolveTranslation

[Source](../packages/core/src/localization.ts#L19)

```ts
resolveTranslation(app: AppDefinition, key: string | undefined, fallback: string | undefined, requestedLocale?: string): string | undefined
```

### RowPolicy

[Source](../packages/core/src/schema.ts#L158)

Type alias.

### RowPolicyRule

[Source](../packages/core/src/schema.ts#L151)

Type alias.

### RowPolicyRuleSchema

[Source](../packages/core/src/schema.ts#L145)

Exported value or type.

### RowPolicySchema

[Source](../packages/core/src/schema.ts#L153)

Exported value or type.

### rowPolicyScope

[Source](../packages/core/src/policy.ts#L12)

```ts
rowPolicyScope(context: TenantContext, doctype: DocTypeDefinition, operation: "read" | "write"): RowPolicyScope
```

### RowPolicyScope

[Source](../packages/core/src/policy.ts#L10)

Type alias.

### SettingDefinition

[Source](../packages/core/src/schema.ts#L323)

Type alias.

### SettingDefinitionSchema

[Source](../packages/core/src/schema.ts#L310)

Exported value or type.

### TenantContext

[Source](../packages/core/src/schema.ts#L208)

Type alias.

### validateSettingValue

[Source](../packages/core/src/settings.ts#L4)

```ts
validateSettingValue(definition: SettingDefinition, value: unknown): string | number | boolean
```

### ViewDefinition

[Source](../packages/core/src/schema.ts#L116)

Type alias.

### ViewSchema

[Source](../packages/core/src/schema.ts#L108)

Exported value or type.

### WorkflowDefinition

[Source](../packages/core/src/schema.ts#L143)

Type alias.

### WorkflowSchema

[Source](../packages/core/src/schema.ts#L136)

Exported value or type.

### WorkflowTransition

[Source](../packages/core/src/schema.ts#L134)

Type alias.

### WorkflowTransitionSchema

[Source](../packages/core/src/schema.ts#L126)

Exported value or type.

## @framekit/realtime

### EventBus

[Source](../packages/realtime/src/index.ts#L9)

Type alias.

### InMemoryEventBus

[Source](../packages/realtime/src/index.ts#L17)

```ts
InMemoryEventBus(): InMemoryEventBus
```

### RealtimeEvent

[Source](../packages/realtime/src/index.ts#L1)

Type alias.

## @framekit/auth

### ApiTokenRecord

[Source](../packages/auth/src/contracts.ts#L28)

Type alias.

### ApiTokenSession

[Source](../packages/auth/src/contracts.ts#L234)

Type alias.

### ApiTokenStore

[Source](../packages/auth/src/contracts.ts#L203)

Type alias.

### assertSecureAuthSecret

[Source](../packages/auth/src/password-policy.ts#L6)

```ts
assertSecureAuthSecret(secret: string, environment?: string | undefined): void
```

### AuthAuditEvent

[Source](../packages/auth/src/contracts.ts#L64)

Type alias.

### AuthAuditSink

[Source](../packages/auth/src/contracts.ts#L75)

Type alias.

### AuthIdentityLink

[Source](../packages/auth/src/contracts.ts#L97)

Type alias.

### AuthIdentityLinkingPolicy

[Source](../packages/auth/src/contracts.ts#L162)

Type alias.

### AuthIdentityLinkStore

[Source](../packages/auth/src/contracts.ts#L107)

Type alias.

### AuthIdentityProvider

[Source](../packages/auth/src/contracts.ts#L90)

Type alias.

### AuthLifecycleDelivery

[Source](../packages/auth/src/contracts.ts#L134)

Type alias.

### AuthLifecycleToken

[Source](../packages/auth/src/contracts.ts#L114)

Type alias.

### AuthLifecycleTokenKind

[Source](../packages/auth/src/contracts.ts#L112)

Type alias.

### AuthLifecycleTokenStore

[Source](../packages/auth/src/contracts.ts#L129)

Type alias.

### AuthProviderIdentity

[Source](../packages/auth/src/contracts.ts#L80)

Type alias.

### AuthRole

[Source](../packages/auth/src/contracts.ts#L19)

Type alias.

### AuthSession

[Source](../packages/auth/src/contracts.ts#L47)

Type alias.

### AuthUser

[Source](../packages/auth/src/contracts.ts#L4)

Type alias.

### bearerToken

[Source](../packages/auth/src/password-policy.ts#L39)

```ts
bearerToken(header: string | null): string | undefined
```

### CreateApiTokenInput

[Source](../packages/auth/src/contracts.ts#L253)

Type alias.

### CreatedApiToken

[Source](../packages/auth/src/contracts.ts#L43)

Type alias.

### createOidcAuthorizationCodeProvider

[Source](../packages/auth/src/oidc-providers.ts#L53)

```ts
createOidcAuthorizationCodeProvider(options: OidcAuthorizationCodeProviderOptions): AuthIdentityProvider
```

### createOidcProvider

[Source](../packages/auth/src/oidc-providers.ts#L6)

```ts
createOidcProvider(options: OidcProviderOptions): AuthIdentityProvider
```

### hashPassword

[Source](../packages/auth/src/password-policy.ts#L24)

```ts
hashPassword(password: string, salt?: string): Promise<string>
```

### InMemoryApiTokenStore

[Source](../packages/auth/src/in-memory-stores.ts#L118)

```ts
InMemoryApiTokenStore(tokens: ApiTokenRecord[]): InMemoryApiTokenStore
```

### InMemoryAuthAuditStore

[Source](../packages/auth/src/in-memory-stores.ts#L235)

```ts
InMemoryAuthAuditStore(): InMemoryAuthAuditStore
```

### InMemoryAuthIdentityLinkStore

[Source](../packages/auth/src/in-memory-stores.ts#L172)

```ts
InMemoryAuthIdentityLinkStore(links: AuthIdentityLink[]): InMemoryAuthIdentityLinkStore
```

### InMemoryAuthLifecycleTokenStore

[Source](../packages/auth/src/in-memory-stores.ts#L199)

```ts
InMemoryAuthLifecycleTokenStore(tokens: AuthLifecycleToken[]): InMemoryAuthLifecycleTokenStore
```

### InMemoryMfaStore

[Source](../packages/auth/src/mfa.ts#L55)

```ts
InMemoryMfaStore(now?: () => number): InMemoryMfaStore
```

Development/test storage only; production needs a durable, shared CAS store.

### InMemoryOidcAuthorizationStateStore

[Source](../packages/auth/src/in-memory-stores.ts#L219)

```ts
InMemoryOidcAuthorizationStateStore(): InMemoryOidcAuthorizationStateStore
```

### InMemoryRoleStore

[Source](../packages/auth/src/in-memory-stores.ts#L81)

```ts
InMemoryRoleStore(roles: AuthRole[]): InMemoryRoleStore
```

### InMemorySessionRevocationStore

[Source](../packages/auth/src/in-memory-stores.ts#L152)

```ts
InMemorySessionRevocationStore(): InMemorySessionRevocationStore
```

### InMemoryUserStore

[Source](../packages/auth/src/in-memory-stores.ts#L5)

```ts
InMemoryUserStore(users: AuthUser[]): InMemoryUserStore
```

### MfaAttempt

[Source](../packages/auth/src/mfa.ts#L46)

Type alias.

### MfaCodeOptions

[Source](../packages/auth/src/mfa.ts#L47)

Type alias.

### MfaFactor

[Source](../packages/auth/src/mfa.ts#L8)

Type alias.

### MfaSecretContext

[Source](../packages/auth/src/mfa.ts#L33)

Type alias.

### MfaSecretPort

[Source](../packages/auth/src/mfa.ts#L41)

Type alias.

Implementations must authenticate the entire context when sealing/unsealing.

### MfaService

[Source](../packages/auth/src/mfa.ts#L77)

```ts
MfaService(store: MfaStore, secrets: MfaSecretPort, options: MfaServiceOptions): MfaService
```

MFA primitives only: callers must authorize enrollment, status, and challenges.

### MfaServiceOptions

[Source](../packages/auth/src/mfa.ts#L48)

Type alias.

### MfaSessionProof

[Source](../packages/auth/src/contracts.ts#L58)

Type alias.

### MfaStore

[Source](../packages/auth/src/mfa.ts#L22)

Type alias.

### OidcAuthorizationCodeProviderOptions

[Source](../packages/auth/src/contracts.ts#L288)

Type alias.

### OidcAuthorizationState

[Source](../packages/auth/src/contracts.ts#L143)

Type alias.

### OidcAuthorizationStateStore

[Source](../packages/auth/src/contracts.ts#L157)

Type alias.

### OidcClaims

[Source](../packages/auth/src/contracts.ts#L263)

Type alias.

### OidcProviderOptions

[Source](../packages/auth/src/contracts.ts#L276)

Type alias.

### PasswordAuthOptions

[Source](../packages/auth/src/contracts.ts#L215)

Type alias.

### PasswordAuthService

[Source](../packages/auth/src/password-auth-service.ts#L37)

```ts
PasswordAuthService(options: PasswordAuthOptions): PasswordAuthService
```

### PublicApiToken

[Source](../packages/auth/src/contracts.ts#L41)

Type alias.

### PublicAuthUser

[Source](../packages/auth/src/contracts.ts#L17)

Type alias.

### RoleStore

[Source](../packages/auth/src/contracts.ts#L197)

Type alias.

### SessionRevocationStore

[Source](../packages/auth/src/contracts.ts#L210)

Type alias.

### totp

[Source](../packages/auth/src/mfa.ts#L321)

```ts
totp(secret: string, step: number): Promise<string>
```

RFC 4226 dynamic truncation, used by RFC 6238 with a 30-second time step.

### UpsertUserInput

[Source](../packages/auth/src/contracts.ts#L241)

Type alias.

### UserStore

[Source](../packages/auth/src/contracts.ts#L171)

Type alias.

### verifyPassword

[Source](../packages/auth/src/password-policy.ts#L30)

```ts
verifyPassword(password: string, passwordHash: string): Promise<boolean>
```

## @framekit/openapi

### createOpenApiDocument

[Source](../packages/openapi/src/index.ts#L21)

```ts
createOpenApiDocument(app: AppDefinition, options?: OpenApiOptions): { openapi: string; info: { title: string; version: string; summary: string; }; servers: { url: string; }[]; paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, JsonSchema>; securitySchemes: { bearerAuth: { type: string; scheme: string; }; cookieAuth: { type: string; in: string; name: string; }; }; parameters: { TenantId: { name: string; in: string; required: boolean; schema: { type: string; }; }; }; }; security: ({ bearerAuth: never[]; cookieAuth?: undefined; } | { cookieAuth: never[]; bearerAuth?: undefined; })[]; }
```

### FRAMEKIT_ROUTE_CATALOG

[Source](../packages/openapi/src/route-catalog.ts#L15)

Exported value or type.

The canonical route inventory. Paths use the default `/api` prefix; adapters
replace that prefix with their configured base path when matching requests.

### FRAMEKIT_STATIC_ROUTE_CATALOG

[Source](../packages/openapi/src/route-catalog.ts#L38)

Exported value or type.

### FramekitRouteDefinition

[Source](../packages/openapi/src/route-catalog.ts#L3)

Type alias.

### FramekitRouteGroup

[Source](../packages/openapi/src/route-catalog.ts#L2)

Type alias.

A transport-neutral description of every HTTP operation implemented by Framekit.

### OpenApiOptions

[Source](../packages/openapi/src/index.ts#L5)

Type alias.

## @framekit/runtime

### addExactDecimals

[Source](../packages/runtime/src/internal/validation.ts#L82)

```ts
addExactDecimals(values: string[], precision: number, scale: number): string
```

### applyFilters

[Source](../packages/runtime/src/internal/query.ts#L91)

```ts
applyFilters(records: DocumentRecord[], filters?: Record<string, FilterValue>, doctype?: DocTypeDefinition): DocumentRecord[]
```

### applyListOptions

[Source](../packages/runtime/src/internal/query.ts#L104)

```ts
applyListOptions(records: DocumentRecord[], options?: ListOptions): DocumentRecord[]
```

### applyListOptionsPage

[Source](../packages/runtime/src/internal/query.ts#L108)

```ts
applyListOptionsPage(records: DocumentRecord[], options?: ListOptions, doctype?: DocTypeDefinition): DocumentPage
```

### appSchemaChecksum

[Source](../packages/runtime/src/internal/migrations.ts#L207)

```ts
appSchemaChecksum(app: AppDefinition): Promise<string>
```

### assertDestructiveMigration

[Source](../packages/runtime/src/internal/migrations.ts#L286)

```ts
assertDestructiveMigration(plan: MigrationPlan, options: { allowDestructive?: boolean; }): void
```

### assertMigrationDrift

[Source](../packages/runtime/src/internal/migrations.ts#L271)

```ts
assertMigrationDrift(latest: MigrationRecord | undefined, plan: MigrationPlan): void
```

### assertMigrationIdentity

[Source](../packages/runtime/src/internal/migrations.ts#L262)

```ts
assertMigrationIdentity(tenant: TenantContext, appName: string, plan: MigrationPlan): void
```

### assertSupportedMigration

[Source](../packages/runtime/src/internal/migrations.ts#L297)

```ts
assertSupportedMigration(plan: MigrationPlan): void
```

### AttachmentStorage

[Source](../packages/runtime/src/internal/types.ts#L412)

Type alias.

### AttachmentUpload

[Source](../packages/runtime/src/internal/types.ts#L425)

Type alias.

### AuditEvent

[Source](../packages/runtime/src/internal/types.ts#L193)

Type alias.

### AuditSink

[Source](../packages/runtime/src/internal/types.ts#L184)

Type alias.

### AuditStore

[Source](../packages/runtime/src/internal/types.ts#L188)

Type alias.

### CommandRowPolicy

[Source](../packages/runtime/src/internal/types.ts#L171)

Type alias.

### createExecutableMigrationArtifact

[Source](../packages/runtime/src/internal/migrations.ts#L169)

```ts
createExecutableMigrationArtifact(plan: MigrationPlan): ExecutableMigrationArtifact
```

### createRollbackMigrationPlan

[Source](../packages/runtime/src/internal/migrations.ts#L181)

```ts
createRollbackMigrationPlan(migration: MigrationRecord, options?: { id?: string; createdAt?: string; }): Promise<MigrationPlan>
```

### createRuntime

[Source](../packages/runtime/src/internal/runtime.ts#L1939)

```ts
createRuntime(app: AppDefinition, options?: RuntimeOptions): FramekitRuntime
```

### CustomizationStore

[Source](../packages/runtime/src/internal/types.ts#L238)

Type alias.

### decodeDocumentCursor

[Source](../packages/runtime/src/internal/query.ts#L323)

```ts
decodeDocumentCursor(cursor: string, sort: ListOptions["sort"], doctype?: DocTypeDefinition): DocumentCursor
```

### DocumentCommandOperation

[Source](../packages/core/src/schema.ts#L307)

Type alias.

### DocumentCommandRequest

[Source](../packages/core/src/schema.ts#L308)

Type alias.

### DocumentCommandResult

[Source](../packages/runtime/src/internal/types.ts#L121)

Type alias.

### DocumentPage

[Source](../packages/runtime/src/internal/types.ts#L47)

Type alias.

### DocumentRepository

[Source](../packages/runtime/src/internal/types.ts#L74)

Type alias.

### encodeDocumentCursor

[Source](../packages/runtime/src/internal/query.ts#L311)

```ts
encodeDocumentCursor(record: DocumentRecord, sort: ListOptions["sort"], doctype?: DocTypeDefinition): string
```

### ExecutableMigrationArtifact

[Source](../packages/runtime/src/internal/types.ts#L360)

Type alias.

### FilterOperator

[Source](../packages/runtime/src/internal/types.ts#L54)

Type alias.

### FilterPrimitive

[Source](../packages/runtime/src/internal/types.ts#L52)

Type alias.

### FilterValue

[Source](../packages/runtime/src/internal/types.ts#L66)

Type alias.

### FramekitRuntime

[Source](../packages/runtime/src/internal/runtime.ts#L40)

```ts
FramekitRuntime(app: AppDefinition, options?: RuntimeOptions): FramekitRuntime
```

### InMemoryAttachmentStorage

[Source](../packages/runtime/src/internal/adapters/memory.ts#L191)

```ts
InMemoryAttachmentStorage(currentTime?: () => number): InMemoryAttachmentStorage
```

### InMemoryAuditStore

[Source](../packages/runtime/src/internal/adapters/memory.ts#L244)

```ts
InMemoryAuditStore(): InMemoryAuditStore
```

### InMemoryCustomizationStore

[Source](../packages/runtime/src/internal/adapters/memory.ts#L528)

```ts
InMemoryCustomizationStore(): InMemoryCustomizationStore
```

### InMemoryDocumentRepository

[Source](../packages/runtime/src/internal/adapters/memory.ts#L58)

```ts
InMemoryDocumentRepository(): InMemoryDocumentRepository
```

### InMemoryMigrationStore

[Source](../packages/runtime/src/internal/adapters/memory.ts#L609)

```ts
InMemoryMigrationStore(): InMemoryMigrationStore
```

### InMemoryMutationUnitOfWork

[Source](../packages/runtime/src/internal/adapters/memory.ts#L396)

```ts
InMemoryMutationUnitOfWork(repository: InMemoryDocumentRepository, audit: InMemoryAuditStore, outbox: InMemoryOutboxStore): InMemoryMutationUnitOfWork
```

### InMemoryNamingSeriesStore

[Source](../packages/runtime/src/internal/adapters/memory.ts#L590)

```ts
InMemoryNamingSeriesStore(): InMemoryNamingSeriesStore
```

### InMemoryOutboxStore

[Source](../packages/runtime/src/internal/adapters/memory.ts#L275)

```ts
InMemoryOutboxStore(): InMemoryOutboxStore
```

### LifecycleResource

[Source](../packages/runtime/src/internal/types.ts#L68)

Type alias.

### ListOptions

[Source](../packages/runtime/src/internal/types.ts#L34)

Type alias.

### MigrationApproval

[Source](../packages/runtime/src/internal/types.ts#L312)

Type alias.

### MigrationChange

[Source](../packages/runtime/src/internal/types.ts#L273)

Type alias.

### migrationChangeIsDestructive

[Source](../packages/runtime/src/internal/migrations.ts#L293)

```ts
migrationChangeIsDestructive(change: Pick<MigrationChange, "kind"> | MigrationRollback): boolean
```

### migrationChecksum

[Source](../packages/runtime/src/internal/migrations.ts#L74)

```ts
migrationChecksum(plan: Pick<MigrationPlan, "tenantId" | "appName" | "fromSchemaChecksum" | "toSchemaChecksum" | "fromUniqueConstraints" | "toUniqueConstraints" | "changes" | "conversions">): Promise<string>
```

### MigrationConversion

[Source](../packages/runtime/src/internal/types.ts#L299)

Type alias.

### MigrationConversionArtifact

[Source](../packages/runtime/src/internal/types.ts#L319)

Type alias.

### MigrationConversionParameters

[Source](../packages/runtime/src/internal/types.ts#L310)

Type alias.

### MigrationPlan

[Source](../packages/runtime/src/internal/types.ts#L285)

Type alias.

### MigrationRecord

[Source](../packages/runtime/src/internal/types.ts#L356)

Type alias.

### MigrationRollback

[Source](../packages/runtime/src/internal/types.ts#L283)

Type alias.

### MigrationStore

[Source](../packages/runtime/src/internal/types.ts#L365)

Type alias.

### MutationBatchResult

[Source](../packages/runtime/src/internal/types.ts#L106)

Type alias.

### MutationCommand

[Source](../packages/runtime/src/internal/types.ts#L92)

Type alias.

### MutationOptions

[Source](../packages/runtime/src/internal/types.ts#L87)

Type alias.

### MutationUnitOfWork

[Source](../packages/runtime/src/internal/types.ts#L111)

Type alias.

### NamingSeriesStore

[Source](../packages/runtime/src/internal/types.ts#L268)

Type alias.

### NoopRealtimePublisher

[Source](../packages/runtime/src/internal/adapters/memory.ts#L664)

```ts
NoopRealtimePublisher(): NoopRealtimePublisher
```

### normalizeExactDecimal

[Source](../packages/runtime/src/internal/validation.ts#L67)

```ts
normalizeExactDecimal(value: unknown, precision: number, scale: number, field?: string): string
```

### OnlineMigrationCheckpoint

[Source](../packages/runtime/src/internal/types.ts#L326)

Type alias.

### OnlineMigrationOptions

[Source](../packages/runtime/src/internal/types.ts#L348)

Type alias.

### OnlineMigrationRun

[Source](../packages/runtime/src/internal/types.ts#L332)

Type alias.

### OutboxClaimOptions

[Source](../packages/runtime/src/internal/types.ts#L219)

Type alias.

### OutboxEvent

[Source](../packages/runtime/src/internal/types.ts#L203)

Type alias.

### OutboxStore

[Source](../packages/runtime/src/internal/types.ts#L227)

Type alias.

### PublicSetting

[Source](../packages/runtime/src/internal/types.ts#L262)

Type alias.

### RealtimePublisher

[Source](../packages/runtime/src/internal/types.ts#L383)

Type alias.

### RepositoryDiagnostics

[Source](../packages/runtime/src/internal/types.ts#L178)

Type alias.

### RuntimeOptions

[Source](../packages/runtime/src/internal/types.ts#L392)

Type alias.

### RuntimeRealtimeEvent

[Source](../packages/runtime/src/internal/types.ts#L375)

Type alias.

### SagaFence

[Source](../packages/runtime/src/internal/types.ts#L128)

Type alias.

### SagaProgress

[Source](../packages/runtime/src/internal/types.ts#L135)

Type alias.

### SagaRecord

[Source](../packages/runtime/src/internal/types.ts#L145)

Type alias.

### SagaStore

[Source](../packages/runtime/src/internal/types.ts#L157)

Type alias.

Claims and saves must lock the same row as fenced mutation transactions.

### SettingsSecretPort

[Source](../packages/runtime/src/internal/types.ts#L257)

Type alias.

### sortRecords

[Source](../packages/runtime/src/internal/query.ts#L279)

```ts
sortRecords(records: DocumentRecord[], sort?: ListOptions["sort"], doctype?: DocTypeDefinition): DocumentRecord[]
```

### StoredSettingValue

[Source](../packages/runtime/src/internal/types.ts#L248)

Type alias.

### validateListOptions

[Source](../packages/runtime/src/internal/query.ts#L38)

```ts
validateListOptions(doctype: DocTypeDefinition, options?: ListOptions): void
```

### validateMigrationPlan

[Source](../packages/runtime/src/internal/migrations.ts#L88)

```ts
validateMigrationPlan(plan: MigrationPlan): Promise<void>
```

## @framekit/db

### createApiTokenTableSql

[Source](../packages/db/src/ddl.ts#L140)

```ts
createApiTokenTableSql(): string
```

### createAuditTableSql

[Source](../packages/db/src/ddl.ts#L202)

```ts
createAuditTableSql(): string
```

### createAuthIdentityLifecycleTablesSql

[Source](../packages/db/src/ddl.ts#L172)

```ts
createAuthIdentityLifecycleTablesSql(): string
```

### createCustomFieldTableSql

[Source](../packages/db/src/ddl.ts#L235)

```ts
createCustomFieldTableSql(): string
```

### createDocumentTableSql

[Source](../packages/db/src/ddl.ts#L53)

```ts
createDocumentTableSql(): string
```

### createMigrationTableSql

[Source](../packages/db/src/ddl.ts#L278)

```ts
createMigrationTableSql(): string
```

### createMutationTablesSql

[Source](../packages/db/src/ddl.ts#L75)

```ts
createMutationTablesSql(): string
```

### createNamingSeriesTableSql

[Source](../packages/db/src/ddl.ts#L266)

```ts
createNamingSeriesTableSql(): string
```

### createOutboxTableSql

[Source](../packages/db/src/ddl.ts#L210)

```ts
createOutboxTableSql(): string
```

### createPostgresConnection

[Source](../packages/db/src/connection.ts#L13)

```ts
createPostgresConnection(input: { connectionString: string; max: number; listenerConnections?: number; totalBudget?: number; }): PostgresConnection
```

### createPostgresMigrationSql

[Source](../packages/db/src/ddl.ts#L325)

```ts
createPostgresMigrationSql(plan: MigrationPlan, options?: { direction?: "up" | "down"; }): string
```

### createPostgresMigrationStatements

[Source](../packages/db/src/ddl.ts#L333)

```ts
createPostgresMigrationStatements(plan: MigrationPlan, options?: { direction?: "up" | "down"; }): string[]
```

### createPostgresRollbackSql

[Source](../packages/db/src/ddl.ts#L329)

```ts
createPostgresRollbackSql(migration: MigrationRecord): string
```

### createRealtimeTableSql

[Source](../packages/db/src/ddl.ts#L222)

```ts
createRealtimeTableSql(): string
```

### createRoleTableSql

[Source](../packages/db/src/ddl.ts#L125)

```ts
createRoleTableSql(): string
```

### createSessionRevocationTableSql

[Source](../packages/db/src/ddl.ts#L160)

```ts
createSessionRevocationTableSql(): string
```

### createSettingValueTableSql

[Source](../packages/db/src/ddl.ts#L251)

```ts
createSettingValueTableSql(): string
```

### createUserTableSql

[Source](../packages/db/src/ddl.ts#L100)

```ts
createUserTableSql(): string
```

### createViewTableSql

[Source](../packages/db/src/ddl.ts#L243)

```ts
createViewTableSql(): string
```

### fixedIndex

[Source](../packages/db/src/schema-contract.ts#L66)

```ts
fixedIndex(table: FixedSchemaTable, name: string): FixedSchemaIndex
```

### fixedIndexDdl

[Source](../packages/db/src/schema-contract.ts#L79)

```ts
fixedIndexDdl(table: FixedSchemaTable): string
```

### fixedSchema

[Source](../packages/db/src/schema-contract.ts#L21)

Exported value or type.

### FixedSchemaColumn

[Source](../packages/db/src/schema-contract.ts#L2)

Type alias.

Fixed relational schema owned by

### FixedSchemaIndex

[Source](../packages/db/src/schema-contract.ts#L9)

Type alias.

### FixedSchemaTable

[Source](../packages/db/src/schema-contract.ts#L15)

Type alias.

### fixedTableDdl

[Source](../packages/db/src/schema-contract.ts#L72)

```ts
fixedTableDdl(table: FixedSchemaTable): string
```

### framekitApiTokens

[Source](../packages/db/src/schema.ts#L103)

Exported value or type.

### framekitAuditEvents

[Source](../packages/db/src/schema.ts#L157)

Exported value or type.

### framekitAuthAuditEvents

[Source](../packages/db/src/schema.ts#L151)

Exported value or type.

### framekitAuthIdentityLinks

[Source](../packages/db/src/schema.ts#L129)

Exported value or type.

### framekitAuthLifecycleTokens

[Source](../packages/db/src/schema.ts#L135)

Exported value or type.

### framekitCustomFields

[Source](../packages/db/src/schema.ts#L210)

Exported value or type.

### framekitDocuments

[Source](../packages/db/src/schema.ts#L51)

Exported value or type.

### framekitDocumentUniqueValues

[Source](../packages/db/src/schema.ts#L183)

Exported value or type.

### framekitIdempotencyKeys

[Source](../packages/db/src/schema.ts#L198)

Exported value or type.

### framekitMigrations

[Source](../packages/db/src/schema.ts#L249)

Exported value or type.

### framekitNamingSeries

[Source](../packages/db/src/schema.ts#L238)

Exported value or type.

### framekitOidcAuthorizationStates

[Source](../packages/db/src/schema.ts#L143)

Exported value or type.

### framekitOutboxEvents

[Source](../packages/db/src/schema.ts#L167)

Exported value or type.

### framekitRoles

[Source](../packages/db/src/schema.ts#L90)

Exported value or type.

### framekitSessionRevocations

[Source](../packages/db/src/schema.ts#L123)

Exported value or type.

### framekitSettingValues

[Source](../packages/db/src/schema.ts#L229)

Exported value or type.

### framekitUsers

[Source](../packages/db/src/schema.ts#L68)

Exported value or type.

### framekitViews

[Source](../packages/db/src/schema.ts#L219)

Exported value or type.

### inspectPostgresSchema

[Source](../packages/db/src/schema-inspection.ts#L11)

```ts
inspectPostgresSchema(sql: Sql, options?: { schema?: string; tables?: readonly FixedSchemaTable[]; }): Promise<{ ok: boolean; checkedTables: string[]; issues: SchemaIssue[]; }>
```

Read-only inspection of the supplied contracts; defaults cover four fixed relational tables.

### migrationConversionArtifactDigest

[Source](../packages/db/src/runtime-adapters.ts#L956)

```ts
migrationConversionArtifactDigest(artifact: string | Uint8Array): Promise<string>
```

### PostgresApiTokenStore

[Source](../packages/db/src/auth-adapters.ts#L258)

```ts
PostgresApiTokenStore(options: PostgresRepositoryOptions): PostgresApiTokenStore
```

### PostgresAuditStore

[Source](../packages/db/src/runtime-adapters.ts#L56)

```ts
PostgresAuditStore(options: PostgresRepositoryOptions): PostgresAuditStore
```

### PostgresAuthAuditStore

[Source](../packages/db/src/auth-adapters.ts#L470)

```ts
PostgresAuthAuditStore(options: PostgresRepositoryOptions): PostgresAuthAuditStore
```

### PostgresAuthIdentityLinkStore

[Source](../packages/db/src/auth-adapters.ts#L360)

```ts
PostgresAuthIdentityLinkStore(options: PostgresRepositoryOptions): PostgresAuthIdentityLinkStore
```

### PostgresAuthLifecycleTokenStore

[Source](../packages/db/src/auth-adapters.ts#L386)

```ts
PostgresAuthLifecycleTokenStore(options: PostgresRepositoryOptions): PostgresAuthLifecycleTokenStore
```

### PostgresConnection

[Source](../packages/db/src/connection.ts#L6)

Type alias.

### PostgresCustomizationStore

[Source](../packages/db/src/runtime-adapters.ts#L465)

```ts
PostgresCustomizationStore(options: PostgresRepositoryOptions): PostgresCustomizationStore
```

### PostgresDocumentRepository

[Source](../packages/db/src/document-repository.ts#L56)

```ts
PostgresDocumentRepository(options: PostgresRepositoryOptions): PostgresDocumentRepository
```

### PostgresMfaStore

[Source](../packages/db/src/mfa-store.ts#L9)

```ts
PostgresMfaStore(options: PostgresRepositoryOptions, limit?: number, windowMs?: number): PostgresMfaStore
```

Durable, shared MFA factor state. Call migrate before serving requests.

### PostgresMigrationStage

[Source](../packages/db/src/types.ts#L17)

Type alias.

### PostgresMigrationStore

[Source](../packages/db/src/runtime-adapters.ts#L594)

```ts
PostgresMigrationStore(options: PostgresMigrationStoreOptions): PostgresMigrationStore
```

### PostgresMigrationStoreOptions

[Source](../packages/db/src/types.ts#L19)

Type alias.

### PostgresMutationStage

[Source](../packages/db/src/types.ts#L11)

Type alias.

### PostgresMutationUnitOfWork

[Source](../packages/db/src/mutation-repository.ts#L56)

```ts
PostgresMutationUnitOfWork(options: PostgresMutationUnitOfWorkOptions): PostgresMutationUnitOfWork
```

### PostgresMutationUnitOfWorkOptions

[Source](../packages/db/src/types.ts#L13)

Type alias.

### PostgresNamingSeriesStore

[Source](../packages/db/src/runtime-adapters.ts#L558)

```ts
PostgresNamingSeriesStore(options: PostgresRepositoryOptions): PostgresNamingSeriesStore
```

### PostgresOidcAuthorizationStateStore

[Source](../packages/db/src/auth-adapters.ts#L425)

```ts
PostgresOidcAuthorizationStateStore(options: PostgresRepositoryOptions): PostgresOidcAuthorizationStateStore
```

### PostgresOutboxStore

[Source](../packages/db/src/runtime-adapters.ts#L103)

```ts
PostgresOutboxStore(options: PostgresRepositoryOptions): PostgresOutboxStore
```

### PostgresRealtimePublisher

[Source](../packages/db/src/runtime-adapters.ts#L263)

```ts
PostgresRealtimePublisher(options: PostgresRealtimePublisherOptions): PostgresRealtimePublisher
```

### PostgresRealtimePublisherOptions

[Source](../packages/db/src/types.ts#L26)

Type alias.

### PostgresRealtimeStage

[Source](../packages/db/src/types.ts#L24)

Type alias.

### PostgresRepositoryOptions

[Source](../packages/db/src/types.ts#L4)

Type alias.

### PostgresRoleStore

[Source](../packages/db/src/auth-adapters.ts#L198)

```ts
PostgresRoleStore(options: PostgresRepositoryOptions): PostgresRoleStore
```

### PostgresSagaStore

[Source](../packages/db/src/saga-store.ts#L15)

```ts
PostgresSagaStore(options: PostgresRepositoryOptions): PostgresSagaStore
```

Uses the same PostgreSQL database as PostgresMutationUnitOfWork.

### PostgresSessionRevocationStore

[Source](../packages/db/src/auth-adapters.ts#L314)

```ts
PostgresSessionRevocationStore(options: PostgresRepositoryOptions): PostgresSessionRevocationStore
```

### PostgresUserStore

[Source](../packages/db/src/auth-adapters.ts#L55)

```ts
PostgresUserStore(options: PostgresRepositoryOptions): PostgresUserStore
```

### SchemaIssue

[Source](../packages/db/src/schema-inspection.ts#L4)

Type alias.

## @framekit/storage

### createAesGcmSettingsSecrets

[Source](../packages/storage/src/secrets.ts#L21)

```ts
createAesGcmSettingsSecrets(options: SettingsKeyringOptions): SettingsSecretPort
```

### decodeSecretKey

[Source](../packages/storage/src/secrets.ts#L15)

```ts
decodeSecretKey(value: string): Uint8Array
```

### S3AttachmentStorage

[Source](../packages/storage/src/s3.ts#L17)

```ts
S3AttachmentStorage(options: S3AttachmentStorageOptions): S3AttachmentStorage
```

### S3AttachmentStorageOptions

[Source](../packages/storage/src/s3.ts#L6)

Type alias.

### SettingsKeyringOptions

[Source](../packages/storage/src/secrets.ts#L4)

Type alias.

## @framekit/jobs

### BullMqQueue

[Source](../packages/jobs/src/queue.ts#L48)

```ts
BullMqQueue(name: string, connectionUrl: string): BullMqQueue
```

### BullMqScheduler

[Source](../packages/jobs/src/durable-scheduler.ts#L6)

```ts
BullMqScheduler(name: string, connectionUrl: string): BullMqScheduler
```

### BullMqWorker

[Source](../packages/jobs/src/queue.ts#L93)

```ts
BullMqWorker(name: string, connectionUrl: string, handler: WorkerHandler, options?: { concurrency?: number; }): BullMqWorker
```

### dispatchOutboxEvents

[Source](../packages/jobs/src/outbox.ts#L25)

```ts
dispatchOutboxEvents(runtime: FramekitRuntime, tenant: TenantContext, handler: OutboxDispatchHandler, options?: OutboxDispatchOptions): Promise<OutboxDispatchResult>
```

### DurableSchedule

[Source](../packages/jobs/src/durable-scheduler.ts#L4)

Type alias.

### InMemoryQueue

[Source](../packages/jobs/src/queue.ts#L22)

```ts
InMemoryQueue(): InMemoryQueue
```

### JobPayload

[Source](../packages/jobs/src/queue.ts#L3)

Type alias.

### OutboxDispatcher

[Source](../packages/jobs/src/outbox.ts#L69)

```ts
OutboxDispatcher(runtime: FramekitRuntime, tenant: TenantContext, handler: OutboxDispatchHandler, options?: OutboxDispatchOptions & { intervalMs?: number; }): OutboxDispatcher
```

### OutboxDispatchHandler

[Source](../packages/jobs/src/outbox.ts#L5)

Type alias.

### OutboxDispatchOptions

[Source](../packages/jobs/src/outbox.ts#L14)

Type alias.

### OutboxDispatchResult

[Source](../packages/jobs/src/outbox.ts#L7)

Type alias.

### QueueHealth

[Source](../packages/jobs/src/queue.ts#L5)

Type alias.

### QueueOptions

[Source](../packages/jobs/src/queue.ts#L15)

Type alias.

### QueuePort

[Source](../packages/jobs/src/queue.ts#L7)

Type alias.

### retryFailedOutboxEvents

[Source](../packages/jobs/src/outbox.ts#L60)

```ts
retryFailedOutboxEvents(runtime: FramekitRuntime, tenant: TenantContext, handler: OutboxDispatchHandler, options?: OutboxDispatchOptions): Promise<OutboxDispatchResult>
```

### ScheduledJob

[Source](../packages/jobs/src/scheduler.ts#L3)

Type alias.

### ScheduledJobRegistry

[Source](../packages/jobs/src/scheduler.ts#L10)

```ts
ScheduledJobRegistry(): ScheduledJobRegistry
```

### ScheduledJobRunner

[Source](../packages/jobs/src/scheduler.ts#L33)

```ts
ScheduledJobRunner(registry: ScheduledJobRegistry, intervalMs?: number): ScheduledJobRunner
```

### WorkerHandler

[Source](../packages/jobs/src/queue.ts#L91)

Type alias.

## @framekit/sdk

### ApiToken

[Source](../packages/sdk/src/types.ts#L5)

Type alias.

### AttachmentDownload

[Source](../packages/sdk/src/types.ts#L22)

Type alias.

### AuthAuditEvent

[Source](../packages/sdk/src/types.ts#L7)

Type alias.

### AuthRole

[Source](../packages/sdk/src/types.ts#L4)

Type alias.

### AuthUser

[Source](../packages/sdk/src/types.ts#L3)

Type alias.

### createClient

[Source](../packages/sdk/src/client.ts#L447)

```ts
createClient(options: FramekitClientOptions): FramekitClient
```

### CreatedApiToken

[Source](../packages/sdk/src/types.ts#L6)

Type alias.

### DependencyHealthResponse

[Source](../packages/sdk/src/types.ts#L24)

Type alias.

### DocumentCommandOperation

[Source](../packages/core/src/schema.ts#L307)

Type alias.

### DocumentCommandResult

[Source](../packages/sdk/src/types.ts#L21)

Type alias.

### FRAMEKIT_HTTP_ENDPOINTS

[Source](../packages/sdk/src/endpoints.ts#L1)

Exported value or type.

### FRAMEKIT_SDK_CONFIG_VERSION

[Source](../packages/sdk/src/types.ts#L16)

Exported value or type.

### FramekitAuthenticationError

[Source](../packages/sdk/src/errors.ts#L5)

```ts
FramekitAuthenticationError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitAuthenticationError
```

### FramekitAuthorizationError

[Source](../packages/sdk/src/errors.ts#L6)

```ts
FramekitAuthorizationError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitAuthorizationError
```

### FramekitCancelledError

[Source](../packages/sdk/src/errors.ts#L14)

```ts
FramekitCancelledError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitCancelledError
```

### FramekitClient

[Source](../packages/sdk/src/client.ts#L43)

```ts
FramekitClient(options: FramekitClientOptions): FramekitClient
```

### FramekitClientConfigV1

[Source](../packages/sdk/src/types.ts#L11)

Type alias.

### FramekitClientConfigV2

[Source](../packages/sdk/src/types.ts#L12)

Type alias.

### FramekitClientOptions

[Source](../packages/sdk/src/types.ts#L13)

Type alias.

### FramekitConfigUpgradeDiagnostic

[Source](../packages/sdk/src/types.ts#L14)

Type alias.

### FramekitConfigUpgradeResult

[Source](../packages/sdk/src/types.ts#L15)

Type alias.

### FramekitConflictError

[Source](../packages/sdk/src/errors.ts#L8)

```ts
FramekitConflictError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitConflictError
```

### FramekitNotFoundError

[Source](../packages/sdk/src/errors.ts#L7)

```ts
FramekitNotFoundError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitNotFoundError
```

### FramekitProtocolError

[Source](../packages/sdk/src/errors.ts#L13)

```ts
FramekitProtocolError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitProtocolError
```

### FramekitRateLimitError

[Source](../packages/sdk/src/errors.ts#L9)

```ts
FramekitRateLimitError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitRateLimitError
```

### FramekitRequestOptions

[Source](../packages/sdk/src/types.ts#L17)

Type alias.

### FramekitResponseError

[Source](../packages/sdk/src/errors.ts#L11)

```ts
FramekitResponseError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitResponseError
```

### FramekitRetryPolicy

[Source](../packages/sdk/src/types.ts#L10)

Type alias.

### FramekitSdkError

[Source](../packages/sdk/src/errors.ts#L1)

```ts
FramekitSdkError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitSdkError
```

### FramekitServerError

[Source](../packages/sdk/src/errors.ts#L10)

```ts
FramekitServerError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitServerError
```

### FramekitTransportError

[Source](../packages/sdk/src/errors.ts#L12)

```ts
FramekitTransportError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitTransportError
```

### FramekitValidationError

[Source](../packages/sdk/src/errors.ts#L4)

```ts
FramekitValidationError(message: string, code: string, status: number | undefined, details: unknown, requestId: string | undefined, retryAfterMs: number | undefined, options?: ErrorOptions): FramekitValidationError
```

### generateSdkTypes

[Source](../packages/sdk/src/generator.ts#L4)

```ts
generateSdkTypes(app: AppDefinition): string
```

### HealthResponse

[Source](../packages/sdk/src/types.ts#L23)

Type alias.

### IssuedLifecycleToken

[Source](../packages/sdk/src/types.ts#L8)

Type alias.

### ListDocumentsOptions

[Source](../packages/sdk/src/types.ts#L18)

Type alias.

### ListDocumentsPage

[Source](../packages/sdk/src/types.ts#L19)

Type alias.

### MigrationChange

[Source](../packages/sdk/src/types.ts#L25)

Type alias.

### MigrationPlan

[Source](../packages/sdk/src/types.ts#L27)

Type alias.

### MigrationRecord

[Source](../packages/sdk/src/types.ts#L28)

Type alias.

### MigrationRollback

[Source](../packages/sdk/src/types.ts#L26)

Type alias.

### MutationRequestOptions

[Source](../packages/sdk/src/types.ts#L20)

Type alias.

### upgradeFramekitClientConfig

[Source](../packages/sdk/src/client.ts#L451)

```ts
upgradeFramekitClientConfig(input: FramekitClientOptions): FramekitConfigUpgradeResult
```

## @framekit/nitro

### assertSecureProductionCredentials

[Source](../packages/nitro/src/production-policy.ts#L8)

```ts
assertSecureProductionCredentials(options: NitroProductionCredentials): void
```

### createNitroHandler

[Source](../packages/nitro/src/index.ts#L134)

```ts
createNitroHandler(runtime: FramekitRuntime, options?: NitroAdapterOptions): EventHandler
```

### createOpenTelemetryAdapters

[Source](../packages/nitro/src/index.ts#L109)

```ts
createOpenTelemetryAdapters(options: { logger?: OpenTelemetryCompatibleLogger; tracer?: OpenTelemetryCompatibleTracer; meter?: OpenTelemetryCompatibleMeter; }): Pick<NitroAdapterOptions, "logger" | "metrics" | "tracer">
```

### NitroAdapterOptions

[Source](../packages/nitro/src/index.ts#L12)

Type alias.

### NitroAuthCookieOptions

[Source](../packages/nitro/src/index.ts#L50)

Type alias.

### NitroCorsOptions

[Source](../packages/nitro/src/index.ts#L28)

Type alias.

### NitroDevelopmentOptions

[Source](../packages/nitro/src/index.ts#L42)

Type alias.

### NitroHealthCheck

[Source](../packages/nitro/src/index.ts#L100)

Type alias.

### NitroHealthCheckResult

[Source](../packages/nitro/src/index.ts#L95)

Type alias.

### NitroHttpSecurityOptions

[Source](../packages/nitro/src/index.ts#L33)

Type alias.

### NitroMetricsSink

[Source](../packages/nitro/src/index.ts#L71)

Type alias.

### NitroProductionCredentials

[Source](../packages/nitro/src/contracts.ts#L1)

Type alias.

### NitroRateLimiter

[Source](../packages/nitro/src/index.ts#L91)

Type alias.

### NitroRateLimitOptions

[Source](../packages/nitro/src/index.ts#L85)

Type alias.

### NitroRequestLogger

[Source](../packages/nitro/src/index.ts#L66)

Type alias.

### NitroRequestTelemetry

[Source](../packages/nitro/src/index.ts#L58)

Type alias.

### NitroTraceSink

[Source](../packages/nitro/src/index.ts#L81)

Type alias.

### NitroTraceSpan

[Source](../packages/nitro/src/index.ts#L75)

Type alias.

### OpenTelemetryCompatibleLogger

[Source](../packages/nitro/src/index.ts#L102)

Type alias.

### OpenTelemetryCompatibleMeter

[Source](../packages/nitro/src/index.ts#L104)

Type alias.

### OpenTelemetryCompatibleTracer

[Source](../packages/nitro/src/index.ts#L103)

Type alias.

### routeParam

[Source](../packages/nitro/src/index.ts#L223)

```ts
routeParam(name: string): string
```

## @framekit/desk-assets

### deskAssetsDirectory

[Source](../packages/desk-assets/index.d.ts#L1)

```ts
deskAssetsDirectory(): string
```

## @framekit/cli

### isValidSemVer

[Source](../packages/cli/src/paths.ts#L96)

```ts
isValidSemVer(value: unknown): value is string
```

### runCli

[Source](../packages/cli/src/dispatch.ts#L4)

```ts
runCli(argv?: string[], io?: { stdout?: Pick<NodeJS.WriteStream, "write">; log?: (message: string) => void; }): Promise<void>
```
