/**
 * 站点模块配置 —— 大厅目录由这一份数组驱动。
 * 未来接入新模块：仅在数组末尾追加一项（status: "live"），
 * 大厅目录、序号与点火行为会自动跟上；也可改为动态接口。
 */
export interface SiteModule {
  id: string;
  /** 行内主字（中文名） */
  title: string;
  /** 英文副标 */
  subtitle: string;
  /** 目标路由 */
  path: string;
  /** 可用状态：live 可进入 / sealed 待点亮 */
  status: "live" | "sealed";
}

export const siteModules: SiteModule[] = [
  { id: "quant", title: "观墨", subtitle: "VAULT OF INK", path: "/quant", status: "live" },
  { id: "blog", title: "手记", subtitle: "FIELD NOTES", path: "/blog", status: "live" },
  { id: "lab", title: "炼墨", subtitle: "INVESTIGATION LAB", path: "/lab", status: "live" },
  { id: "tools", title: "器", subtitle: "TOOLKIT", path: "/tools", status: "sealed" },
  { id: "monogram", title: "铭", subtitle: "ORIGIN", path: "/about", status: "sealed" },
  { id: "data", title: "数", subtitle: "DATA LEDGER", path: "/data", status: "sealed" },
  { id: "atlas", title: "图", subtitle: "ATLAS", path: "/atlas", status: "live" },
  { id: "signal", title: "讯", subtitle: "SIGNALS", path: "/signal", status: "sealed" },
  { id: "query", title: "问", subtitle: "QUERY", path: "/query", status: "sealed" }
];

export const liveModuleId = siteModules.find((m) => m.status === "live")?.id ?? null;
