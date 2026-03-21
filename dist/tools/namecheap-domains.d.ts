/**
 * Namecheap domain management tools.
 *
 * Provides domain lifecycle operations: list, info, check availability,
 * register, renew, reactivate, lock/unlock, contacts, and TLD list.
 *
 * Tools exposed:
 *   namecheap_domains_list          - List all domains in the account
 *   namecheap_domains_get_info      - Get full info for a specific domain
 *   namecheap_domains_check         - Check domain availability for registration
 *   namecheap_domains_register      - Register a new domain
 *   namecheap_domains_renew         - Renew a domain
 *   namecheap_domains_reactivate    - Reactivate an expired domain
 *   namecheap_domains_get_lock      - Get registrar lock status
 *   namecheap_domains_set_lock      - Enable/disable registrar lock
 *   namecheap_domains_get_contacts  - Get WHOIS contact info
 *   namecheap_domains_get_tld_list  - Get available TLDs and pricing
 *   namecheap_domains_get_env       - Show current API environment (sandbox/production)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerNamecheapDomainTools(server: McpServer): void;
//# sourceMappingURL=namecheap-domains.d.ts.map