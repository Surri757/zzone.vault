import AtlasMap from "@/components/atlas/AtlasMap";
import GoldCursor from "@/components/GoldCursor";

export const metadata = {
  title: "图 · 舆图 — Zz.one Vault"
};

export default function AtlasPage() {
  return (
    <>
      <GoldCursor />
      <AtlasMap />
    </>
  );
}
