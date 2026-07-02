import { type ProviderProbe, type RotationPlanSpec } from "./cred-rotation.js";
export interface RotationOutcome {
    outcome: "done" | "failed" | "blocked";
    detail: string;
}
export interface RotationDeps {
    bws: {
        /** value of a secret by UUID; null when absent/unreadable */
        getValue(uuid: string): Promise<string | null>;
        /** find a secret by exact key name (scoped to a project when given); null when absent */
        findByName(name: string, projectId?: string): Promise<{
            id: string;
            value: string;
        } | null>;
        create(name: string, value: string, projectId: string): Promise<string>;
        editValue(uuid: string, value: string): Promise<void>;
        remove(uuid: string): Promise<void>;
    };
    keychain: {
        read(service: string, account: string): Promise<string | null>;
        write(service: string, account: string, value: string): Promise<void>;
        remove(service: string, account: string): Promise<void>;
    };
    coolify: {
        getEnv(instance: string, resourceType: string, uuid: string, key: string): Promise<string | null>;
        setEnv(instance: string, resourceType: string, uuid: string, key: string, value: string): Promise<void>;
        redeploy(instance: string, uuid: string): Promise<void>;
    };
    ghSecretSet(repo: string, name: string, value: string): Promise<void>;
    /** HTTP status of the class-specific provider auth probe for `value` */
    probe(kind: ProviderProbe, value: string): Promise<number>;
    /** the standing gh CLI keeper still authenticates (keeper-verification discipline) */
    ghKeeperOk(): Promise<boolean>;
    state: {
        /** one read-modify-write: mark exposures resolved AND record lastRotated */
        completeRotation(credId: string, exposureIds: string[], detail: string): Promise<void>;
    };
}
export declare function runRotationPlan(plan: RotationPlanSpec, deps: RotationDeps): Promise<RotationOutcome>;
export declare function defaultRotationDeps(io: {
    coolifyGet: <T>(path: string, instance?: string) => Promise<T>;
    coolifyPatch: <T>(path: string, body: unknown, instance?: string) => Promise<T>;
    coolifyPost: <T>(path: string, body: unknown | undefined, instance?: string) => Promise<T>;
    loadState: () => import("./cred-rotation.js").RotationState;
    saveState: (s: import("./cred-rotation.js").RotationState) => void;
    now: string;
}): RotationDeps;
//# sourceMappingURL=rotation-executor.d.ts.map