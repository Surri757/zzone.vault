export type PeerMarket = "CN" | "US";

export interface PeerInstrumentRef {
  id: string;
  market: PeerMarket;
  symbol: string;
  name: string;
  role: string;
}

export interface PeerEvidenceLink {
  label: string;
  url: string;
}

export interface CrossMarketPeerGroup {
  id: string;
  category: string;
  theme: string;
  focus: string;
  cn: PeerInstrumentRef;
  us: PeerInstrumentRef;
  matchAxes: readonly [string, string, string];
  sharedDemand: string;
  difference: string;
  evidence: readonly [PeerEvidenceLink, PeerEvidenceLink];
}

export const peerMatchMethod = {
  title: "高关联严选",
  summary: "只收录核心产品、产业链位置和主要需求端同时重合的 A 股 / 美股组合。",
  axes: ["核心产品重合", "产业链位置相近", "主要需求端重合"] as const,
};

export const crossMarketPeerGroups: readonly CrossMarketPeerGroup[] = [
  {
    id: "inp-substrates",
    category: "半导体材料",
    theme: "磷化铟衬底",
    focus: "III-V 族化合物半导体衬底",
    cn: {
      id: "CN:XSHE:002428",
      market: "CN",
      symbol: "002428",
      name: "云南锗业",
      role: "磷化铟、砷化镓及锗衬底材料",
    },
    us: {
      id: "US:XNAS:AXTI",
      market: "US",
      symbol: "AXTI",
      name: "AXT",
      role: "磷化铟、砷化镓及锗衬底材料",
    },
    matchAxes: ["磷化铟衬底", "上游晶体与衬底材料", "光通信与高速数据传输"],
    sharedDemand: "共同受益于光模块、数据中心互连和射频器件对 III-V 族衬底的需求。",
    difference: "云南锗业还覆盖锗资源与红外材料；AXT 的业务更集中于化合物半导体衬底。",
    evidence: [
      {
        label: "云南锗业：III-V 族衬底产线",
        url: "http://www.sino-ge.com/view/ynzyPC/7/512/view/1255.html",
      },
      {
        label: "AXT：Indium Phosphide",
        url: "https://www.axt.com/products/indium-phosphide/",
      },
    ],
  },
  {
    id: "pure-play-foundry",
    category: "半导体制造",
    theme: "晶圆代工",
    focus: "纯晶圆代工与特色工艺平台",
    cn: {
      id: "CN:XSHG:688981",
      market: "CN",
      symbol: "688981",
      name: "中芯国际",
      role: "多节点晶圆代工平台",
    },
    us: {
      id: "US:XNAS:GFS",
      market: "US",
      symbol: "GFS",
      name: "GlobalFoundries",
      role: "特色工艺晶圆代工平台",
    },
    matchAxes: ["晶圆代工", "芯片制造中游", "汽车、通信与工业芯片"],
    sharedDemand: "两者均以代工产能、工艺平台和客户投片需求驱动收入。",
    difference: "GlobalFoundries 更聚焦特色工艺；中芯国际覆盖的制程组合与中国本地需求权重不同。",
    evidence: [
      { label: "中芯国际：公司官网", url: "https://www.smics.com/en/" },
      { label: "GlobalFoundries：公司官网", url: "https://gf.com/" },
    ],
  },
  {
    id: "wafer-etch",
    category: "半导体设备",
    theme: "晶圆刻蚀设备",
    focus: "先进制程等离子体刻蚀",
    cn: {
      id: "CN:XSHG:688012",
      market: "CN",
      symbol: "688012",
      name: "中微公司",
      role: "刻蚀、MOCVD 等晶圆制造设备",
    },
    us: {
      id: "US:XNAS:LRCX",
      market: "US",
      symbol: "LRCX",
      name: "Lam Research",
      role: "刻蚀、沉积与清洗晶圆设备",
    },
    matchAxes: ["等离子体刻蚀设备", "晶圆厂资本开支", "逻辑与存储制造"],
    sharedDemand: "核心变量均是晶圆厂扩产、先进制程层数提升及刻蚀步骤增加。",
    difference: "Lam 的设备组合和全球客户覆盖更广；中微同时布局 MOCVD 等设备。",
    evidence: [
      {
        label: "中微公司：产品与解决方案",
        url: "https://www.amec-inc.com/index/Lists/index/catid/27.html",
      },
      { label: "Lam Research：Etch", url: "https://www.lamresearch.com/products/etch/" },
    ],
  },
  {
    id: "semiconductor-osat",
    category: "半导体制造",
    theme: "封装与测试",
    focus: "独立半导体封装测试 OSAT",
    cn: {
      id: "CN:XSHG:600584",
      market: "CN",
      symbol: "600584",
      name: "长电科技",
      role: "芯片封装设计、制造与测试",
    },
    us: {
      id: "US:XNAS:AMKR",
      market: "US",
      symbol: "AMKR",
      name: "Amkor Technology",
      role: "芯片封装设计、制造与测试",
    },
    matchAxes: ["OSAT", "封装测试中游", "通信、汽车与高性能计算"],
    sharedDemand: "两者直接承接芯片设计公司和晶圆厂的先进封装与测试需求。",
    difference: "客户地域、封装产能分布及具体先进封装平台结构不同。",
    evidence: [
      { label: "长电科技：公司官网", url: "https://www.jcetglobal.com/en/" },
      { label: "Amkor：Packaging", url: "https://amkor.com/packaging/" },
    ],
  },
  {
    id: "memory-interface",
    category: "半导体设计",
    theme: "内存接口芯片",
    focus: "DDR 内存接口与配套芯片",
    cn: {
      id: "CN:XSHG:688008",
      market: "CN",
      symbol: "688008",
      name: "澜起科技",
      role: "内存接口、模组配套与互连芯片",
    },
    us: {
      id: "US:XNAS:RMBS",
      market: "US",
      symbol: "RMBS",
      name: "Rambus",
      role: "内存接口芯片与高速接口 IP",
    },
    matchAxes: ["DDR 内存接口", "服务器内存链路", "数据中心与 AI 服务器"],
    sharedDemand: "服务器内存代际升级、通道数提升和高速互连需求是共同驱动因素。",
    difference: "Rambus 还拥有较大规模接口 IP 业务；澜起的模组配套芯片组合更突出。",
    evidence: [
      { label: "澜起科技：Memory Interface", url: "https://www.montage-tech.com/Memory_Interface" },
      {
        label: "Rambus：Memory Interface Chips",
        url: "https://www.rambus.com/interface-ip/memory-interface-chips/",
      },
    ],
  },
  {
    id: "high-speed-pcb",
    category: "电子制造",
    theme: "高速高层 PCB",
    focus: "通信与数据中心印制电路板",
    cn: {
      id: "CN:XSHE:002463",
      market: "CN",
      symbol: "002463",
      name: "沪电股份",
      role: "企业通信与汽车高层 PCB",
    },
    us: {
      id: "US:XNAS:TTMI",
      market: "US",
      symbol: "TTMI",
      name: "TTM Technologies",
      role: "高层、HDI 与射频 PCB",
    },
    matchAxes: ["印制电路板", "高层高速制造", "数据中心与通信设备"],
    sharedDemand: "AI 服务器、交换机和高速通信设备提升层数、材料与加工精度要求。",
    difference: "TTM 的航空航天与国防业务占比更高；沪电股份的中国数据通信产业链暴露更集中。",
    evidence: [
      { label: "沪电股份：公司官网", url: "https://www.wuscn.com/" },
      {
        label: "TTM：Printed Circuit Boards",
        url: "https://www.ttm.com/en/solutions/printed-circuit-boards",
      },
    ],
  },
  {
    id: "heavy-duty-engines",
    category: "工业装备",
    theme: "重型动力系统",
    focus: "柴油发动机与动力总成",
    cn: {
      id: "CN:XSHE:000338",
      market: "CN",
      symbol: "000338",
      name: "潍柴动力",
      role: "重卡发动机、动力总成与动力系统",
    },
    us: {
      id: "US:XNYS:CMI",
      market: "US",
      symbol: "CMI",
      name: "Cummins",
      role: "发动机、动力系统与零排放动力",
    },
    matchAxes: ["商用柴油发动机", "动力系统供应商", "重卡、工程机械与发电"],
    sharedDemand: "商用车景气、排放升级、工程机械和备用电源需求共同影响订单。",
    difference: "潍柴还覆盖整车、变速箱与物流资产；Cummins 的全球区域与新能源动力布局不同。",
    evidence: [
      { label: "潍柴动力：公司官网", url: "https://en.weichai.com/" },
      { label: "Cummins：Engines", url: "https://www.cummins.com/engines" },
    ],
  },
  {
    id: "lithium-materials",
    category: "新能源材料",
    theme: "锂资源与锂盐",
    focus: "上游锂资源和电池级锂化合物",
    cn: {
      id: "CN:XSHE:002460",
      market: "CN",
      symbol: "002460",
      name: "赣锋锂业",
      role: "锂资源、锂盐与电池产业链",
    },
    us: {
      id: "US:XNYS:ALB",
      market: "US",
      symbol: "ALB",
      name: "Albemarle",
      role: "全球锂资源与锂化合物供应商",
    },
    matchAxes: ["锂资源", "电池级锂盐", "动力与储能电池"],
    sharedDemand: "锂价、资源扩产节奏及电动车与储能电池需求是共同核心变量。",
    difference: "赣锋向下游电池延伸更深；Albemarle 的资产区域和非锂业务结构不同。",
    evidence: [
      { label: "赣锋锂业：公司官网", url: "https://www.ganfenglithium.com/" },
      {
        label: "Albemarle：Energy Storage",
        url: "https://www.albemarle.com/global/en/about/businesses/energy-storage",
      },
    ],
  },
  {
    id: "construction-machinery",
    category: "工业装备",
    theme: "工程机械",
    focus: "挖掘机与大型施工设备",
    cn: {
      id: "CN:XSHG:600031",
      market: "CN",
      symbol: "600031",
      name: "三一重工",
      role: "挖掘、混凝土、起重与路面机械",
    },
    us: {
      id: "US:XNYS:CAT",
      market: "US",
      symbol: "CAT",
      name: "Caterpillar",
      role: "工程、矿山设备与动力系统",
    },
    matchAxes: ["工程机械", "整机制造商", "基建、地产与矿业资本开支"],
    sharedDemand: "基础设施、矿业和建筑活动直接影响设备销量、开工小时与售后需求。",
    difference: "Caterpillar 的矿山、动力与全球经销网络更广；三一的中国与新兴市场权重更高。",
    evidence: [
      { label: "三一：公司官网", url: "https://www.sanyglobal.com/" },
      { label: "Caterpillar：Cat 品牌", url: "https://www.caterpillar.com/en/brands/cat.html" },
    ],
  },
];
