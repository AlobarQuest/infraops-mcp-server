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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  namecheapCommand,
  handleNamecheapError,
  getNamecheapEnvironment,
} from '../services/namecheap-client.js';

export function registerNamecheapDomainTools(server: McpServer): void {
  // ═══════════════════════════════════════════════════════════════════
  //  ENVIRONMENT INFO
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_get_env',
    {
      title: 'Namecheap Environment',
      description:
        'Show which Namecheap API environment is active (sandbox or production) and the configured API user.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const env = getNamecheapEnvironment();
      const user = process.env.NAMECHEAP_API_USER ?? '(not set)';
      const clientIp = process.env.NAMECHEAP_CLIENT_IP ?? '(not set)';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                environment: env,
                apiUser: user,
                clientIp,
                note:
                  env === 'sandbox'
                    ? 'Running against sandbox. Set NAMECHEAP_USE_SANDBOX=false for production.'
                    : 'Running against PRODUCTION. All operations are live.',
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  LIST DOMAINS
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_list',
    {
      title: 'List Domains',
      description:
        'List all domains in the Namecheap account with expiry dates, lock status, and auto-renew settings.',
      inputSchema: {
        page: z.number().int().min(1).default(1).describe('Page number (default: 1)'),
        pageSize: z
          .number()
          .int()
          .min(10)
          .max(100)
          .default(100)
          .describe('Results per page (default: 100, max: 100)'),
        sortBy: z
          .enum([
            'NAME',
            'NAME_DESC',
            'EXPIREDATE',
            'EXPIREDATE_DESC',
            'CREATEDATE',
            'CREATEDATE_DESC',
          ])
          .default('NAME')
          .describe('Sort order'),
        searchTerm: z.string().optional().describe('Filter domains containing this keyword'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { page: number; pageSize: number; sortBy: string; searchTerm?: string }) => {
      try {
        const commandParams: Record<string, string | number | boolean> = {
          ListType: 'ALL',
          Page: params.page,
          PageSize: params.pageSize,
          SortBy: params.sortBy,
        };
        if (params.searchTerm) commandParams.SearchTerm = params.searchTerm;

        const result = await namecheapCommand('namecheap.domains.getList', commandParams);

        return {
          content: [{ type: 'text', text: JSON.stringify(result.CommandResponse, null, 2) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  GET DOMAIN INFO
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_get_info',
    {
      title: 'Get Domain Info',
      description:
        'Get detailed information about a specific domain: status, creation/expiry dates, ' +
        'nameservers, WHOIS guard, lock status, and DNS provider details.',
      inputSchema: {
        domain: z.string().min(3).describe("Domain name (e.g. 'devonwatkins.com')"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ domain }: { domain: string }) => {
      try {
        const result = await namecheapCommand('namecheap.domains.getInfo', {
          DomainName: domain,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result.CommandResponse, null, 2) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  CHECK DOMAIN AVAILABILITY
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_check',
    {
      title: 'Check Domain Availability',
      description:
        'Check if one or more domains are available for registration. Supports checking multiple domains at once.',
      inputSchema: {
        domains: z
          .array(z.string().min(3))
          .min(1)
          .max(50)
          .describe("Domain names to check (e.g. ['example.com', 'example.net'])"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ domains }: { domains: string[] }) => {
      try {
        const result = await namecheapCommand('namecheap.domains.check', {
          DomainList: domains.join(','),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result.CommandResponse, null, 2) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  REGISTER DOMAIN
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_register',
    {
      title: 'Register Domain',
      description:
        'Register a new domain. Requires registrant contact information. ' +
        '⚠️ This is a PAID operation — it will charge your Namecheap account balance.',
      inputSchema: {
        domain: z.string().min(3).describe("Domain to register (e.g. 'mynewdomain.com')"),
        years: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(1)
          .describe('Registration period in years (default: 1)'),
        nameservers: z
          .string()
          .optional()
          .describe('Comma-separated custom nameservers. Omit for Namecheap default DNS.'),
        addWhoisGuard: z.boolean().default(true).describe('Enable WHOIS privacy (default: true)'),
        registrantFirstName: z.string().describe('Registrant first name'),
        registrantLastName: z.string().describe('Registrant last name'),
        registrantAddress1: z.string().describe('Registrant street address'),
        registrantCity: z.string().describe('Registrant city'),
        registrantState: z.string().describe('Registrant state/province code'),
        registrantPostalCode: z.string().describe('Registrant postal/zip code'),
        registrantCountry: z.string().describe("Registrant country code (e.g. 'US')"),
        registrantPhone: z.string().describe("Registrant phone (e.g. '+1.5551234567')"),
        registrantEmail: z.string().email().describe('Registrant email address'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: Record<string, unknown>) => {
      try {
        const commandParams: Record<string, string | number | boolean> = {
          DomainName: String(params.domain),
          Years: Number(params.years ?? 1),
          AddFreeWhoisguard: params.addWhoisGuard ? 'yes' : 'no',
          WGEnabled: params.addWhoisGuard ? 'yes' : 'no',
        };

        if (params.nameservers) commandParams.Nameservers = String(params.nameservers);

        // Contact info — Namecheap requires all four contact types to match
        const contactPrefixes = ['Registrant', 'Tech', 'Admin', 'AuxBilling'];

        const fieldMap: Record<string, string> = {
          registrantFirstName: 'FirstName',
          registrantLastName: 'LastName',
          registrantAddress1: 'Address1',
          registrantCity: 'City',
          registrantState: 'StateProvince',
          registrantPostalCode: 'PostalCode',
          registrantCountry: 'Country',
          registrantPhone: 'Phone',
          registrantEmail: 'EmailAddress',
        };

        for (const [paramKey, apiField] of Object.entries(fieldMap)) {
          const value = String(params[paramKey] ?? '');
          for (const prefix of contactPrefixes) {
            commandParams[`${prefix}${apiField}`] = value;
          }
        }

        const result = await namecheapCommand('namecheap.domains.create', commandParams);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  domain: params.domain,
                  years: params.years,
                  whoisGuard: params.addWhoisGuard,
                  response: result.CommandResponse,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  RENEW DOMAIN
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_renew',
    {
      title: 'Renew Domain',
      description:
        'Renew a domain registration. ⚠️ This is a PAID operation — charges your account balance.',
      inputSchema: {
        domain: z.string().min(3).describe('Domain to renew'),
        years: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(1)
          .describe('Renewal period in years (default: 1)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ domain, years }: { domain: string; years: number }) => {
      try {
        const result = await namecheapCommand('namecheap.domains.renew', {
          DomainName: domain,
          Years: years,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  domain,
                  years,
                  response: result.CommandResponse,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  REACTIVATE DOMAIN
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_reactivate',
    {
      title: 'Reactivate Domain',
      description:
        'Reactivate an expired domain (if still within the redemption grace period). ' +
        '⚠️ PAID operation — reactivation fees may apply.',
      inputSchema: {
        domain: z.string().min(3).describe('Expired domain to reactivate'),
        years: z.number().int().min(1).max(10).default(1).describe('Renewal period in years'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ domain, years }: { domain: string; years: number }) => {
      try {
        const result = await namecheapCommand('namecheap.domains.reactivate', {
          DomainName: domain,
          Years: years,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { success: true, domain, years, response: result.CommandResponse },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  GET REGISTRAR LOCK
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_get_lock',
    {
      title: 'Get Domain Lock Status',
      description:
        'Check whether the registrar lock is enabled for a domain (prevents unauthorized transfers).',
      inputSchema: {
        domain: z.string().min(3).describe('Domain name'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ domain }: { domain: string }) => {
      try {
        const result = await namecheapCommand('namecheap.domains.getRegistrarLock', {
          DomainName: domain,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result.CommandResponse, null, 2) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  SET REGISTRAR LOCK
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_set_lock',
    {
      title: 'Set Domain Lock',
      description:
        'Enable or disable the registrar lock on a domain. ' +
        'When locked, the domain cannot be transferred to another registrar.',
      inputSchema: {
        domain: z.string().min(3).describe('Domain name'),
        lock: z.boolean().describe('true to enable lock, false to disable'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ domain, lock }: { domain: string; lock: boolean }) => {
      try {
        const result = await namecheapCommand('namecheap.domains.setRegistrarLock', {
          DomainName: domain,
          LockAction: lock ? 'LOCK' : 'UNLOCK',
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  domain,
                  locked: lock,
                  response: result.CommandResponse,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  GET CONTACTS
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_get_contacts',
    {
      title: 'Get Domain Contacts',
      description: 'Get WHOIS contact information for a domain (registrant, admin, tech, billing).',
      inputSchema: {
        domain: z.string().min(3).describe('Domain name'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ domain }: { domain: string }) => {
      try {
        const result = await namecheapCommand('namecheap.domains.getContacts', {
          DomainName: domain,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result.CommandResponse, null, 2) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  //  GET TLD LIST
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    'namecheap_domains_get_tld_list',
    {
      title: 'Get TLD List',
      description:
        'Get the list of available TLDs (top-level domains) with registration and renewal pricing.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await namecheapCommand('namecheap.domains.getTldList');
        return {
          content: [{ type: 'text', text: JSON.stringify(result.CommandResponse, null, 2) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleNamecheapError(error) }] };
      }
    },
  );
}
