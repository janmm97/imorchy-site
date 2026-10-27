// The visitor's Gmail, through their One Connect grant. Exactly the four actions the playground's ask grants:
// read the profile, list emails, create a draft, send a draft. Anything else is outside the grant and One refuses it.
// Method and path are given here, so no call waits on a catalog lookup.
export const ACTIONS = {
  profile: { actionId: "conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng", method: "GET", path: "/gmail/v1/users/{{userId}}/profile" },
  list: { actionId: "conn_mod_def::GGSNOTZxFUU::ZWXBuJboTpS3Q_U06pF8gA", method: "POST", path: "/v1/gmail/get-emails" },
  draft: { actionId: "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ", method: "POST", path: "/v1/gmail/create-draft" },
  send: { actionId: "conn_mod_def::GJ3oatTRIQc::fj4wiYxZRuG68hX235-sUg", method: "POST", path: "/gmail/v1/users/{{userId}}/drafts/send" },
};
const BODY_CHARS = 2000; // per email, so a long newsletter can't eat the run

export class GmailError extends Error {
  constructor(message, { grant = false, status } = {}) {
    super(message);
    this.grant = grant;
    this.status = status;
  }
}

/** `run` is oneConnect.runAction bound to this visitor: (input) => RunActionResult. */
export function gmailFor(run, connectionKey) {
  async function call(action, { body, pathParams } = {}) {
    const { actionId, method, path } = ACTIONS[action];
    // One's own Gmail actions (list, create-draft) read the connection key from the body.
    const payload = path.startsWith("/v1/") ? { ...body, connectionKey } : body;
    const res = await run({ connectionKey, actionId, method, path, pathParams, body: payload });
    if (res.blockedByGrant) throw new GmailError("That's outside what you granted Orchy.", { grant: true, status: res.status });
    if (!res.ok) throw new GmailError(`Gmail answered ${res.status}.`, { status: res.status });
    return res.data;
  }
  return {
    async address() {
      const data = await call("profile", { pathParams: { userId: "me" } });
      return String(data?.emailAddress || "").toLowerCase();
    },
    async search(query, max) {
      const data = await call("list", { body: { query: String(query || "in:inbox"), numberOfEmails: Math.min(Math.max(Number(max) || 5, 1), 10) } });
      return (data?.emails || []).map((e) => ({
        id: e.messageId,
        threadId: e.threadId,
        from: e.sender,
        to: e.receiver,
        date: e.time,
        subject: e.subject,
        unread: (e.labelIds || []).includes("UNREAD"),
        text: String(e.body || e.snippet || "").slice(0, BODY_CHARS),
      }));
    },
    async createDraft({ to, subject, body, threadId }) {
      const data = await call("draft", { body: { to, subject, body, ...(threadId ? { threadId } : {}) } });
      if (!data?.draftId) throw new GmailError("Gmail didn't return a draft.");
      return { draftId: data.draftId, threadId: data.threadId };
    },
    async sendDraft(draftId) {
      const data = await call("send", { pathParams: { userId: "me" }, body: { id: draftId } });
      return { messageId: data?.id, threadId: data?.threadId };
    },
  };
}
