// Outbound reply formatting, kept dependency-free for unit tests.
//
// The subject is the threading contract with inbound email: it must carry the
// #<number> tag that extractTicketNumber() parses, so the requester's answer
// lands back on the same ticket instead of opening a new one.

const SUBJECT_TITLE_LIMIT = 80;

/** Subject for a reply sent to the requester of ticket #number. */
export function replySubject(number: number, title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const clipped =
    clean.length > SUBJECT_TITLE_LIMIT ? `${clean.slice(0, SUBJECT_TITLE_LIMIT - 1)}…` : clean;
  return `Re: [Servo] #${number} ${clipped}`.trim();
}
