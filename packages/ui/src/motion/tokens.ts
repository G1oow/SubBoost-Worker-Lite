/**
 * 动效参数的单一来源。
 *
 * 分工与 tailwind v4 的 `--animate-*` 令牌互补：
 * - 需要 FLIP / 共享布局（layoutId）的场景只能用 JS 驱动，参数放这里；
 * - 单纯进出场的覆盖层、弹窗、菜单、Toast 走纯 CSS（globals.css 的 `--animate-*`），
 *   由 Radix Presence 监听 animationend 决定卸载时机，零 JS 开销。
 *
 * 为什么这里用 tween 而不是 spring：
 * 1. spring 按物理规律收敛，阻尼比 < 1 时必然过冲终值再回弹。观感就是
 *    「冲过头又被拉回」——动画跑完了才落到正确位置，正是要避免的毛病。
 *    tween 的进度由缓动曲线定义，1 时精确等于目标值，最后一帧即归位。
 * 2. spring 的实际时长取决于参数组合，多条列表项同时进场时收尾参差；
 *    tween 的时长是确定的，成组动画的结束时刻可以对齐。
 *
 * 为什么这里连位移都不用（只动 opacity）：
 * 位移（translate/y）会把元素提升为独立合成层，Chrome 只栅格化一次纹理，
 * 之后按非整数设备像素逐帧平移，插值采样把整块内容糊掉 —— 文字边缘发虚、
 * 卡片阴影的柔和过渡被抹平（看起来像"动画期间没渲染阴影"）。入场位移只有几像素，
 * 不值得为此牺牲整屏锐度。scale 的问题更严重：它还要改变尺寸、逐帧重采样字形。
 */

/** 统一的 ease-out 曲线：起步快、收尾缓，末帧精确落在终值上 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** 退场用的 ease-in：越走越快，读起来"利落地离开" */
export const EASE_IN = [0.4, 0, 1, 1] as const;

/** 列表项进场：略长于退场，让新内容稳当地落位 */
export const LIST_ITEM_TRANSITION = { duration: 0.22, ease: EASE_OUT } as const;

/** 列表项退场：比进场快，删除操作才显得干脆 */
export const LIST_ITEM_EXIT_TRANSITION = { duration: 0.16, ease: EASE_IN } as const;

/**
 * FLIP 重排（其余项滑动补位）。
 * 用 tween 而非 spring：spring 的过冲会让整行在抵达新位置后"晃一下"，
 * 行内文字跟着抖，正是要消除的抖动来源。
 */
export const LIST_LAYOUT_TRANSITION = { duration: 0.24, ease: EASE_OUT } as const;
/**
 * 列表项进场：只淡入，不写 y。
 * 位移会触发合成层重采样（见文件头说明），行内文字在动画期间发虚。
 * 退场时长写在 exit 目标对象里：Motion 没有顶层的 exitTransition prop。
 */
export const LIST_ITEM_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: LIST_ITEM_EXIT_TRANSITION },
} as const;

/** 收起/展开的内容区：高度由内容决定，只做淡入与位移 */
export const REVEAL_MOTION = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" as const },
  exit: { opacity: 0, height: 0 },
} as const;

export const REVEAL_TRANSITION = { duration: 0.22, ease: EASE_OUT } as const;

/**
 * 分段控件滑块（layoutId 共享布局）。
 * 只要有回弹，滑块就会越过目标格再退回来，视觉上和"点错了格"难以区分，
 * 所以同样用 tween：停在目标格就结束，不再多动一帧。
 */
export const PILL_TRANSITION = { duration: 0.26, ease: EASE_OUT } as const;

/**
 * 增长条：物理弹簧。
 *
 * 为什么从 tween 换成 spring：
 * 条长完全由数据决定（占比、节点数随时会变）。tween 是一条固定时长曲线，
 * 数据一变就得整段重跑，观感是「跳回起点重新填一遍」；spring 从**当前值**
 * 继续推进，天然连续，正是示例里「数字骑在条末端跟线滑动」的效果。
 *
 * 为什么 damping 取 27 而不是示例里的 20：
 * ζ = damping / (2·√(stiffness·mass)) = 27 / (2·√180) ≈ 1.006，刚好越过临界阻尼。
 * 示例的 20 对应 ζ≈0.75，会越过目标约 2.8% 再弹回来 —— 数字先跳到 6 再掉回 5，
 * 条也会冲过头再缩回，正是要消除的「动画跑完被强制归位」。
 * 27 保留弹簧起步快、收尾缓的手感，但最后一帧精确停在目标值。该约束由
 * motion-primitives.test.ts 用物理公式断言守护。
 */
export const GROW_BAR_SPRING = {
  type: "spring",
  stiffness: 180,
  damping: 27,
  mass: 1,
} as const;
