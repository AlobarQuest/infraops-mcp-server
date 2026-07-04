/**
 * Namecheap DNS management tools.
 *
 * Provides DNS record CRUD for domains managed via Namecheap.
 *
 * IMPORTANT: Namecheap's setHosts API is a full-replace operation.
 * To add/update/delete a single record, we always:
 *   1. getHosts (fetch current records)
 *   2. Modify the array in memory
 *   3. setHosts (push entire set back)
 *
 * Tools exposed:
 *   namecheap_dns_get_hosts     - List all DNS records for a domain
 *   namecheap_dns_get_servers   - Get nameservers for a domain
 *   namecheap_dns_add_record    - Add a single DNS record (preserves existing)
 *   namecheap_dns_update_record - Update a DNS record by matching name+type
 *   namecheap_dns_delete_record - Delete a DNS record by matching name+type+address
 *   namecheap_dns_set_hosts     - Full replace of all DNS records (advanced)
 *   namecheap_dns_set_nameservers - Set custom nameservers
 *   namecheap_dns_set_default   - Reset to Namecheap default DNS
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerNamecheapDNSTools(server: McpServer): void;
//# sourceMappingURL=namecheap-dns.d.ts.map