import {
    SharedTemplate,
    Template,
    TemplateStatus,
    TemplateType,
} from '@activepieces/shared'

// ─── Flow JSONs ───────────────────────────────────────────────────────────────
// Each file matches the SharedTemplate shape exported by the Activepieces builder.
// To add a new template:
//   1. Build your flow in the Activepieces builder
//   2. Export it  (3-dot menu → "Download as template" / "Export")
//   3. Save the downloaded .json file into this folder  (eightbit-flows/)
//   4. Add an import below and a fromSharedTemplate(...) entry in TEMPLATES
import zendeskGetTicket from './eightbit-flows/zendesk_get_ticket.json'
import zendeskListOpenTickets from './eightbit-flows/zendesk_list_open_tickets.json'
import ticketSummary from './eightbit-flows/ticket_summary.json'
import zendeskGetUsers from './eightbit-flows/zendesk_get_users.json'
import zendeskListUrgentTickets from './eightbit-flows/zendesk_list_urgent_tickets.json'
import zendeskUpdateTicket from './eightbit-flows/zendesk_update_ticket.json'
import escalationHandler from './eightbit-flows/escalation_handler.json'
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORY_8BIT_TEMPLATES = '8bit_templates'

const NOW = new Date().toISOString()

/**
 * Converts a SharedTemplate JSON (the format Activepieces exports when you
 * download a flow) into a full Template registered under the 8bit category.
 *
 * The `id` param becomes "8bit-<id>" so it can be recognised quickly without
 * touching the DB.  Every other field is taken straight from the JSON so the
 * real flow structure (trigger, steps, pieces) is preserved.
 */
function fromSharedTemplate(id: string, data: SharedTemplate): Template {
    return {
        id: `8bit-${id}`,
        created: NOW,
        updated: NOW,
        name: data.name,
        type: TemplateType.OFFICIAL,
        summary: data.summary,
        description: data.description,
        tags: data.tags ?? [],
        blogUrl: data.blogUrl ?? null,
        metadata: data.metadata ?? null,
        author: data.author || '8bit.ai',
        categories: [CATEGORY_8BIT_TEMPLATES],
        pieces: data.pieces ?? [],
        platformId: null,
        flows: data.flows ?? [],
        status: TemplateStatus.PUBLISHED,
    }
}

// ─── Registered templates ─────────────────────────────────────────────────────
const TEMPLATES: Template[] = [
    fromSharedTemplate('zendesk_get_ticket', zendeskGetTicket as unknown as SharedTemplate),
    fromSharedTemplate('zendesk_list_open_tickets', zendeskListOpenTickets as unknown as SharedTemplate),
    fromSharedTemplate('ticket_summary', ticketSummary as unknown as SharedTemplate),
    fromSharedTemplate('zendesk_get_users', zendeskGetUsers as unknown as SharedTemplate),
    fromSharedTemplate('zendesk_list_urgent_tickets', zendeskListUrgentTickets as unknown as SharedTemplate),
    fromSharedTemplate('zendesk_update_ticket', zendeskUpdateTicket as unknown as SharedTemplate),
    fromSharedTemplate('escalation_handler', escalationHandler as unknown as SharedTemplate),
]
// ─────────────────────────────────────────────────────────────────────────────

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]))

export function get8bitTemplateIds(): string[] {
    return TEMPLATES.map((t) => t.id)
}

/**
 * Returns templates WITHOUT the flows array — used for the list/card view,
 * consistent with how cloud.activepieces.com serves its list endpoint.
 * Keeps cards lightweight and avoids rendering the EMPTY trigger icon in the
 * card's PieceIconList.
 */
export function get8bitTemplates(): Template[] {
    return TEMPLATES.map(({ flows: _flows, ...rest }) => rest as Template)
}

export function get8bitTemplateById(id: string): Template | undefined {
    return BY_ID.get(id)
}

export function is8bitTemplateId(id: string): boolean {
    return id.startsWith('8bit-')
}
