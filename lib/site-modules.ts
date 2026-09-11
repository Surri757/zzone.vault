import {
  Activity,
  BookOpen,
  Database,
  FlaskConical,
  MessageSquare,
  Orbit as OrbitIcon,
  type LucideIcon,
  Radar,
  Scroll,
  Wrench
} from "lucide-react";

/**
 * 站点模块配置 —— 每一张卡牌、每一处导航都由这一份数组驱动。
 * 未来接入新模块：仅在数组末尾追加一项（status: "live"），
 * 星阵封面、全站导航、占位卡、SEO 会自动跟上；也可改为动态接口。
 */
export interface SiteModule {
  id: string;
  /** 卡面主字（儒雅中文名） */
  title: string;
  /** 英文副标 */
  subtitle: string;
  /** 一句话说明 */
  description: string;
  /** 目标路由 */
  path: string;
  /** 可用状态：live 真模块 / sealed 占位 */
  status: "live" | "sealed";
  icon: LucideIcon;
}

export const siteModules: SiteModule[] = [
  {
    id: "quant",
    title: "观墨",
    subtitle: "VAULT OF INK",
    description: "以墨观势，驭数入墨 —— 本地私有量化研究、组合分析与模拟交易工作台。",
    path: "/quant",
    status: "live",
    icon: Radar
  },
  {
    id: "blog",
    title: "手记",
    subtitle: "FIELD NOTES",
    description: "研究随笔与市场观察，即将点亮。",
    path: "/blog",
    status: "sealed",
    icon: BookOpen
  },
  {
    id: "lab",
    title: "炼墨",
    subtitle: "INVESTIGATION LAB",
    description: "指标与策略实验工坊，即将点亮。",
    path: "/lab",
    status: "sealed",
    icon: FlaskConical
  },
  {
    id: "tools",
    title: "器",
    subtitle: "TOOLKIT",
    description: "常用工具与脚本收藏，即将点亮。",
    path: "/tools",
    status: "sealed",
    icon: Wrench
  },
  {
    id: "monogram",
    title: "铭",
    subtitle: "ORIGIN",
    description: "关于我，与这条路的起点。",
    path: "/about",
    status: "sealed",
    icon: Scroll
  },
  {
    id: "data",
    title: "数",
    subtitle: "DATA LEDGER",
    description: "数据仓库与行情归档，即将点亮。",
    path: "/data",
    status: "sealed",
    icon: Database
  },
  {
    id: "atlas",
    title: "图",
    subtitle: "ATLAS",
    description: "市场图谱与关系网络，即将点亮。",
    path: "/atlas",
    status: "sealed",
    icon: OrbitIcon
  },
  {
    id: "signal",
    title: "讯",
    subtitle: "SIGNALS",
    description: "信号与提醒聚合，即将点亮。",
    path: "/signal",
    status: "sealed",
    icon: Activity
  },
  {
    id: "query",
    title: "问",
    subtitle: "QUERY",
    description: "自然语言问数，即将点亮。",
    path: "/query",
    status: "sealed",
    icon: MessageSquare
  }
];

export const liveModuleId = siteModules.find((m) => m.status === "live")?.id ?? null;