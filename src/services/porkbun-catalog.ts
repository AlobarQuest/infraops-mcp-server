/**
 * Reviewed classification of every tool served by the pinned Porkbun MCP server.
 *
 * infraops starts @porkbunllc/mcp-server as a child process and forwards calls
 * to it. A test lists the installed package's tools and fails if any is missing
 * from DENIED_TOOLS or TOOL_AREAS, so an upgrade cannot add an unreviewed tool.
 *
 * Environment variables:
 *   PORKBUN_TOOL_GROUPS - Comma-separated areas to expose (default: all allowed tools)
 */

export const PORKBUN_PACKAGE_VERSION = '0.54.0';

export const PORKBUN_AREAS = [
  'account',
  'cloudflare',
  'dns',
  'docs',
  'domains',
  'email',
  'hosting',
  'marketplace',
  'ssl',
  'webhooks',
] as const;

export type PorkbunArea = (typeof PORKBUN_AREAS)[number];

// profiles.js SANDBOX, TOPUPS, PURCHASES in 0.54.0, plus the API-key-request tools.
export const DENIED_TOOLS: ReadonlySet<string> = new Set([
  // Sandbox
  'create_sandbox_key',
  'sandbox_topup',
  'sandbox_reset',
  'sandbox_trigger_webhook',
  // Top-ups
  'top_up_account_credit',
  'configure_auto_topup',
  'top_up_with_usdc',
  'get_usdc_topup_status',
  'top_up_with_card_mpp',
  // Purchases
  'register_domain',
  'renew_domain',
  'transfer_domain',
  'buy_closeout',
  'create_hosting',
  'create_mailbox',
  'renew_mailbox',
  // API-key requests
  'request_api_key',
  'retrieve_api_key',
]);

const AREA_TOOLS: Readonly<Record<PorkbunArea, readonly string[]>> = {
  account: [
    'ping',
    'get_balance',
    'get_auto_topup',
    'get_api_settings',
    'get_pricing',
    'mock_call',
    'list_invoices',
    'get_invoice',
    'get_invoice_pdf',
    'send_phone_verification_code',
    'confirm_phone_verification',
    'send_email_verification_code',
    'confirm_email_verification',
  ],
  cloudflare: [
    'get_cloudflare_connection',
    'list_cloudflare_inventory',
    'connect_domains_to_cloudflare',
    'get_cloudflare_queue',
    'get_cloudflare_domain_status',
    'retry_cloudflare_domain',
    'rollback_cloudflare_domain',
    'disconnect_cloudflare',
    'get_cloudflare_records',
    'set_cloudflare_proxy',
    'preview_cloudflare_move',
    'get_cloudflare_zone',
    'get_cloudflare_zone_settings',
    'set_cloudflare_zone_settings',
    'create_cloudflare_record',
    'edit_cloudflare_record',
    'delete_cloudflare_record',
  ],
  dns: [
    'list_dns_records',
    'create_dns_record',
    'update_dns_record',
    'delete_dns_record',
    'scan_dns_records',
    'import_dns_records',
    'list_dnssec_records',
    'create_dnssec_record',
    'delete_dnssec_record',
    'list_dns_restore_points',
    'diff_dns_restore_point',
    'restore_dns_zone',
  ],
  docs: ['list_doc_topics', 'read_doc', 'search_docs'],
  domains: [
    'check_domain',
    'check_domains',
    'get_registration_requirements',
    'preflight_domain',
    'list_domains',
    'get_domain',
    'get_contacts',
    'update_contacts',
    'get_nameservers',
    'update_nameservers',
    'update_auto_renew',
    'list_url_forwards',
    'create_url_forward',
    'delete_url_forward',
    'list_glue_records',
    'create_glue_record',
    'update_glue_record',
    'delete_glue_record',
    'list_transfers',
    'get_transfer_status',
    'get_transfer_setup',
    'prepare_transfer',
    'start_transfer',
    'cancel_transfer',
    'update_transfer_auth_code',
  ],
  email: [
    'list_email_forwards',
    'create_email_forward',
    'delete_email_forward',
    'list_mailboxes',
    'setup_mailbox',
    'set_email_password',
  ],
  hosting: [
    'list_hosting_plans',
    'get_hosting',
    'deploy_site',
    'list_hosting_files',
    'delete_hosting_file',
    'make_hosting_dir',
    'delete_hosting',
    'create_wp_credentials',
    'list_wp_credentials',
    'delete_wp_credentials',
  ],
  marketplace: ['list_marketplace', 'search_closeouts', 'search_aftermarket', 'get_closeout'],
  ssl: ['get_ssl_bundle'],
  webhooks: [
    'get_webhook_event_types',
    'list_webhooks',
    'get_webhook',
    'list_webhook_deliveries',
    'get_webhook_delivery',
    'create_webhook',
    'update_webhook',
    'rotate_webhook_secret',
    'test_webhook',
    'resend_webhook',
    'delete_webhook',
  ],
};

export const TOOL_AREAS: Readonly<Record<string, PorkbunArea>> = Object.fromEntries(
  Object.entries(AREA_TOOLS).flatMap(([area, names]) =>
    names.map((name) => [name, area as PorkbunArea]),
  ),
);

const AREAS: ReadonlySet<string> = new Set(PORKBUN_AREAS);

/** Parse PORKBUN_TOOL_GROUPS: null (unset or blank) means every allowed tool. */
export function parseToolGroups(raw: string | undefined): ReadonlySet<PorkbunArea> | null {
  if (raw === undefined || raw.trim() === '') return null;
  const groups = raw
    .split(',')
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);
  const unknown = groups.filter((g) => !AREAS.has(g));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown PORKBUN_TOOL_GROUPS area(s): ${unknown.join(', ')}. Valid: ${[...AREAS].join(', ')}`,
    );
  }
  return new Set(groups as PorkbunArea[]);
}

export function isExposed(name: string, groups: ReadonlySet<PorkbunArea> | null): boolean {
  if (DENIED_TOOLS.has(name)) return false;
  if (!Object.hasOwn(TOOL_AREAS, name)) return false;
  return groups === null || groups.has(TOOL_AREAS[name]);
}
