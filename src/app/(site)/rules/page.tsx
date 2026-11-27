import { getViewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { renderBB } from "@/lib/format";

export default async function RulesPage() {
  await getViewer();
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="card">
        <div className="card-h text-lg">📜 Правила форума</div>
        <div className="card-b bb" dangerouslySetInnerHTML={{ __html: renderBB(s.str("rulesText"), { allowImages: false }) }} />
      </div>
    </div>
  );
}
