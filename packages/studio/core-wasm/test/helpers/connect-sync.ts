// The engine-sync helper moved to node/connect-sync.ts (the Nitro render uses it outside the tests); this keeps
// every existing import path working.
export {connectSyncToEngine} from "../../node/connect-sync"
export type {EngineSync} from "../../node/connect-sync"
