import { type FramekitClient } from "@framekit/sdk";
import { apiUrl, createFramekitClient } from "../api/framekit";
import { type CustomerData, type CustomerRecord, metadataDocTypeCount } from "../domain/customer";

export type HealthResult =
  | { available: true; app: string; apiUrl: string }
  | { available: false; error: unknown };
export type RegisterResult = { customers: CustomerRecord[]; docTypeCount: number; apiUrl: string };

export class LedgerState {
  private client = createFramekitClient();
  private activeLoad: AbortController | undefined;
  private signedIn = false;
  private sessionGeneration = 0;

  async checkHealth(): Promise<HealthResult | undefined> {
    const generation = this.sessionGeneration;
    try {
      const health = await this.client.health();
      return this.isCurrentGeneration(generation) ? { available: true, app: health.app, apiUrl } : undefined;
    } catch (error) {
      return this.isCurrentGeneration(generation) ? { available: false, error } : undefined;
    }
  }

  async signIn(email: string, password: string): Promise<boolean> {
    const generation = this.sessionGeneration;
    const loginClient = this.client;
    await loginClient.login(email.trim(), password);
    if (!this.isCurrentGeneration(generation) || this.client !== loginClient) return false;
    this.signedIn = true;
    this.sessionGeneration += 1;
    return true;
  }

  async signOut(): Promise<unknown | undefined> {
    const previousClient = this.client;
    const generation = this.invalidateSession();
    try {
      await previousClient.logout();
    } catch (error) {
      return this.isCurrentGeneration(generation) ? error : undefined;
    }
  }

  async loadRegister(): Promise<RegisterResult | undefined> {
    if (!this.signedIn) return undefined;
    const generation = this.sessionGeneration;
    const loadClient = this.client;
    this.activeLoad?.abort();
    const controller = new AbortController();
    this.activeLoad = controller;
    try {
      const [metadata, customers] = await Promise.all([
        loadClient.meta({}),
        loadClient.listPage<CustomerData>("customer", { limit: 50, signal: controller.signal })
      ]);
      if (!this.isCurrentSession(generation, loadClient)) return undefined;
      return { customers: customers.items, docTypeCount: metadataDocTypeCount(metadata), apiUrl };
    } catch (error) {
      if (controller.signal.aborted || !this.isCurrentSession(generation, loadClient)) return undefined;
      throw error;
    } finally {
      if (this.activeLoad === controller) this.activeLoad = undefined;
    }
  }

  async createCustomer(data: CustomerData): Promise<CustomerRecord | undefined> {
    if (!this.signedIn) return undefined;
    const generation = this.sessionGeneration;
    const createClient = this.client;
    try {
      const customer = await createClient.create<CustomerData>("customer", data, { idempotencyKey: crypto.randomUUID() });
      return this.isCurrentSession(generation, createClient) ? customer : undefined;
    } catch (error) {
      if (!this.isCurrentSession(generation, createClient)) return undefined;
      throw error;
    }
  }

  isSignedIn(): boolean {
    return this.signedIn;
  }

  teardown(): void {
    this.invalidateSession();
  }

  private invalidateSession(): number {
    this.sessionGeneration += 1;
    this.activeLoad?.abort();
    this.activeLoad = undefined;
    this.signedIn = false;
    this.client = createFramekitClient();
    return this.sessionGeneration;
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.sessionGeneration === generation;
  }

  private isCurrentSession(generation: number, requestClient: FramekitClient): boolean {
    return this.signedIn && this.isCurrentGeneration(generation) && this.client === requestClient;
  }
}
