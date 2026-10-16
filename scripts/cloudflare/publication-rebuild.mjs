// "Publish the site again although no content changed": used after the code of the site changed (a merge into main),
// because the publication worker only builds when the content revision is newer than the published one.
// It raises the revision by one with a compare-and-set: if somebody changed it in between, a newer revision already asks
// for a publication and nothing is written. The secret key goes into request headers only and never into a message.
export async function requestRebuild({ supabaseUrl, secretKey, fetchImpl = fetch, now = () => new Date() }) {
  if (!/^https:\/\//.test(supabaseUrl)) throw new Error("the database address must be https");
  const base = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/content_revision`;
  const headers = { apikey: secretKey, authorization: `Bearer ${secretKey}`, "content-type": "application/json" };
  const call = async (url, init) => {
    const response = await fetchImpl(url, { ...init, headers: { ...headers, ...init?.headers }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`content revision request failed with status ${response.status}`);
    return response;
  };

  const [row] = await (await call(`${base}?select=current_revision&singleton=eq.true`)).json();
  const updatedAt = now().toISOString();
  if (!row) {
    await call(base, { method: "POST", body: JSON.stringify({ singleton: true, current_revision: 1, updated_at: updatedAt }) });
    return { bumped: true, from: 0, to: 1 };
  }
  const from = Number(row.current_revision);
  const changed = await (await call(`${base}?singleton=eq.true&current_revision=eq.${from}`, {
    method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ current_revision: from + 1, updated_at: updatedAt }),
  })).json();
  return changed.length === 1 ? { bumped: true, from, to: from + 1 } : { bumped: false, from, to: from };
}
