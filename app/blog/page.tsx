import FlowTheater from "@/components/notes/FlowTheater";
import GoldCursor from "@/components/GoldCursor";

export const metadata = {
  title: "手记 · 分时资金剧场 — Zz.one Vault"
};

export default function NotesPage() {
  return (
    <>
      <GoldCursor />
      <FlowTheater />
    </>
  );
}
