# Paper Library 外观协议 v3

外观（Appearance）是覆盖 Paper Library 三个界面的完整表现层，不是配色主题。它可以改变左侧导航、论文主页和右侧详情的布局、尺寸、层级、材质与动效，但不能复制、修改或绕过论文数据和交互逻辑。

内置外观：

| id | 名称 | 基础骨架 | 色彩模式 | 动效 |
| --- | --- | --- | --- | --- |
| `standard` | 标准视图 | `standard` | adaptive | subtle |
| `gallery` | 画廊视图 | `gallery` | light | subtle |
| `paperglass` | 纸境视图 | `paperglass` | light | ambient |
| `blueprint` | 蓝图方案（“我的外观”基础布局） | `blueprint` | light | precise |
| `custom` | 自定义外观 | 用户选择 | 继承骨架 | custom |

## 1. 根节点契约

插件会给三个页面根节点添加相同的外观信息：

```html
<div
  class="paperlib-appearance-paperglass paperlib-appearance-base-paperglass"
  data-paperlib-appearance="paperglass"
  data-paperlib-appearance-base="paperglass"
  data-paperlib-appearance-protocol="3"
  data-paperlib-surface="library"
  data-paperlib-color-scheme="light"
  data-paperlib-motion="ambient"
  data-paperlib-density="comfortable"
  data-paperlib-geometry="fluid"
  data-paperlib-navigation="glass"
  data-paperlib-detail-layout="cards">
</div>
```

### 稳定属性

- `data-paperlib-appearance`：当前外观 id。
- `data-paperlib-custom-appearance`：仅“我的外观”存在，表示当前配置的稳定 id。
- `data-paperlib-appearance-base`：实际继承的结构骨架。
- `data-paperlib-appearance-protocol`：当前协议版本。
- `data-paperlib-surface`：`navigation`、`library` 或 `detail`。
- `data-paperlib-color-scheme`：`light`、`dark` 或 `adaptive`。
- `data-paperlib-motion`：`subtle`、`ambient` 或 `custom`。
- `data-paperlib-density`：`comfortable` 或 `compact`，用于行高与控件密度。
- `data-paperlib-geometry`：`native`、`archival`、`fluid`、`technical` 或 `custom`。
- `data-paperlib-navigation`：导航的视觉模型，如 `list`、`index`、`glass`、`rail`。
- `data-paperlib-detail-layout`：详情的信息组织模型，如 `pane`、`folio`、`cards`、`dossier`。

外观应优先使用这些 data 属性和 `paperlib-appearance-base-*` 类，不要依赖内部历史命名。`.paperlib-severance-view` 仅用于兼容旧画廊 CSS。v3 新增字段都有默认值，v2 外观无需迁移即可继续运行。

## 2. 设计令牌

### 所有外观都可用

```css
--paperlib-global-accent
--paperlib-accent-strong
--paperlib-accent-soft
--paperlib-accent-border
--interactive-accent
--interactive-accent-hover
--text-accent
--text-accent-hover
--paperlib-density-row
--paperlib-density-control
--paperlib-density-gap
--paperlib-control-radius
--paperlib-panel-radius
--paperlib-card-radius
```

`--paperlib-global-accent` 来自设置中的“全局强调色”。外观应从它派生颜色，不应写死品牌色。

### 画廊骨架

```css
--paperlib-severance-carpet
--paperlib-severance-carpet-deep
--paperlib-severance-paper
--paperlib-severance-ink
```

### 纸境骨架

```css
--paperlib-pg-bg
--paperlib-pg-bg-raised
--paperlib-pg-text
--paperlib-pg-text-dim
--paperlib-pg-text-faint
--paperlib-pg-loud
--paperlib-pg-ice
--paperlib-pg-ice-strong
--paperlib-pg-glass-hi
--paperlib-pg-glass-lo
--paperlib-pg-line
--paperlib-pg-line-strong
--paperlib-pg-shadow
```

### 蓝图骨架

```css
--paperlib-bp-navy
--paperlib-bp-navy-2
--paperlib-bp-cyan
--paperlib-bp-paper
--paperlib-bp-board
--paperlib-bp-line
--paperlib-bp-line-strong
--paperlib-bp-ink
--paperlib-bp-muted
```

基础外观同时提供左栏 eyebrow、主页 eyebrow、motto 与 mark。展示文案由外观注册表定义，不再由页面针对特定主题写死；自定义外观会自动继承所选骨架的文案和结构元数据。

`blueprint` 是结构方案而非一级模板：它只出现在“我的外观”的基础布局选项中。协议仍保留其内部 id，以兼容已经保存的选择；旧的独立蓝图选择会自动迁移为 `custom + blueprint`。

## 3. 三个表面与稳定组件

协议 v3 保证下列入口在同一主版本内保持语义稳定。

### Navigation / 左侧导航

- 根节点：`.paperlib-native-sidebar`
- 面板：`.paperlib-sidebar`
- 标题：`.paperlib-sidebar-title`、`.paperlib-sidebar-identity`
- 导航：`.paperlib-nav`、`.paperlib-nav-item`
- 分类：`.paperlib-collections`、`.paperlib-collection-item`
- 标签：`.paperlib-tag-dock`、`.paperlib-tag-search`、`.paperlib-tag-cloud`
- 底栏：`.paperlib-sidebar-bottom`

### Library / 论文主页

- 根节点：`.paperlib-root`
- 页面：`.paperlib-main`
- 工具栏：`.paperlib-toolbar`、`.paperlib-search`
- 标题区域：`.paperlib-severance-masthead`、`.paperlib-list-head`
- 列表容器：`.paperlib-table-host`、`.paperlib-table`
- 表头：`.paperlib-table-header`
- 论文条目：`.paperlib-paper-row`
- 状态栏：`.paperlib-table-status`

论文行中的语义单元：

- `.paperlib-favorite`
- `.paperlib-attachment`
- `.paperlib-authors`
- `.paperlib-year`
- `.paperlib-title`
- `.paperlib-table-rating`
- `.paperlib-venue`
- `.paperlib-rankings`

`.paperlib-table` 直接包含表头和 `.paperlib-paper-row`，不存在 `.paperlib-table-body`。

### Detail / 右侧详情

- 根节点：`.paperlib-native-detail`
- 页面：`.paperlib-detail`
- 顶栏：`.paperlib-detail-bar`、`.paperlib-detail-tabs`
- 滚动区：`.paperlib-detail-scroll`
- 信息：`.paperlib-info-header`、`.paperlib-abstract`、`.paperlib-meta-section`
- 数据：`.paperlib-data-heading`、`.paperlib-metrics-grid`、`.paperlib-metric-card`
- 关系：`.paperlib-relations-block`、`.paperlib-relation-section`
- 编辑：`.paperlib-inline-editor`
- 附件：`.paperlib-attachments-page`
- 导出：`.paperlib-export-page`

### 状态类

- `.is-active`
- `.is-selected`
- `.is-checked`
- `.is-importing`
- `.is-disabled`
- `.paperlib-mobile-layout`

外观不得移除键盘焦点、隐藏仍需访问的操作，或修改 `data-paperlib-*` 数据属性。

## 4. “我的外观”配置

在插件设置中：

1. 在“管理我的外观”中新建或选择一个配置。
2. 为该配置选择标准、画廊、纸境或蓝图基础布局。
3. 填写该配置独立的自定义 CSS。
4. 从当前设备的外观选择器或“我的外观”子菜单中启用它。

每个配置独立保存 `id`、`name`、`base` 与 `css`。蓝图是不可误删的预置配置，但仍属于“我的外观”，不占用一级模板入口。当前配置 ID 与外观选择一样保存在设备本地，因此桌面端和移动端可以选择不同的“我的外观”。

CSS 会在以下作用域中运行：

```css
@scope ([data-paperlib-custom-appearance="appearance-id"]) {
  /* 用户 CSS */
}
```

因此它会同时覆盖三个表面，但不会污染其他外观或 Obsidian 页面。

### 按表面重排示例

```css
/* 主页面使用非对称卡片网格 */
[data-paperlib-surface="library"] .paperlib-table {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

[data-paperlib-surface="library"] .paperlib-paper-row {
  width: auto !important;
  min-width: 0 !important;
  min-height: 180px;
}

/* 左栏成为悬浮面板 */
[data-paperlib-surface="navigation"] .paperlib-sidebar {
  margin: 12px;
  height: calc(100% - 24px);
  border-radius: 22px;
}

/* 详情页采用玻璃阅读卡 */
[data-paperlib-surface="detail"] .paperlib-info-header {
  padding: 22px;
  border-radius: 20px;
  backdrop-filter: blur(18px);
}
```

## 5. 响应式和动效规则

- 移动端根节点会附加 `.paperlib-mobile-layout`。
- 卡片必须保持 `min-width: 0`，长标题应允许换行或截断。
- 右侧详情必须保留纵向滚动和触控惯性。
- 触控设备不应依赖 hover 才能暴露必要操作。
- 所有环境动效必须响应 `prefers-reduced-motion: reduce`。
- 不应使用 `cursor: none`，以免破坏 Obsidian 原生交互。
- `backdrop-filter` 必须提供不依赖模糊的可读背景作为回退。

## 6. 兼容规则

1. 未识别的外观 id 回退到标准视图。
2. 旧设置 `libraryViewStyle: severance` 自动迁移到 `gallery`。
3. 每个“我的外观”先继承自身选择的基础布局（含布局元数据和展示文案），再执行该配置自己的 CSS。
4. 外观只能改变表现，不能改变论文字段、事件语义或持久化格式。
5. 新增协议字段时必须提供合理默认值，旧外观无需迁移即可继续工作。
6. 破坏稳定组件或 data 属性需要提升协议主版本。
