import ModuleHall from "@/components/ModuleHall";
import GoldCursor from "@/components/GoldCursor";

export const metadata = {
  title: "观墨宝阁 · Zz.one 模块大厅"
};

export default function ModulesPage() {
  return (
    <>
      <GoldCursor />
      <ModuleHall />
    </>
  );
}