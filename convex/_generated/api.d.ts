/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_chat from "../agent/chat.js";
import type * as agent_schemas from "../agent/schemas.js";
import type * as agent_tools from "../agent/tools.js";
import type * as campaigns from "../campaigns.js";
import type * as chat from "../chat.js";
import type * as donations from "../donations.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_reporting from "../lib/reporting.js";
import type * as lib_status from "../lib/status.js";
import type * as lib_time from "../lib/time.js";
import type * as reporting from "../reporting.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/chat": typeof agent_chat;
  "agent/schemas": typeof agent_schemas;
  "agent/tools": typeof agent_tools;
  campaigns: typeof campaigns;
  chat: typeof chat;
  donations: typeof donations;
  "lib/money": typeof lib_money;
  "lib/reporting": typeof lib_reporting;
  "lib/status": typeof lib_status;
  "lib/time": typeof lib_time;
  reporting: typeof reporting;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
