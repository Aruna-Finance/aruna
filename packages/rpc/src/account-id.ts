// NEAR account id rules (nomicon, "Account ID"): 2 to 64 characters, lowercase letters and digits,
// separated by single `-` or `_` within a part and `.` between parts, none at either end.
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isValidAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && ACCOUNT_ID.test(id);
}
