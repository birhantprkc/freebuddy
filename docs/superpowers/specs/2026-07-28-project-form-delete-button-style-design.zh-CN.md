# 编辑项目弹窗：底部按钮统一样式

日期：2026-07-28  
状态：已定稿（实现中修订）

## 背景

`ProjectFormModal` 底部「删除 / 取消 / 保存」布局正确，但视觉不齐：删除偏抢眼，取消与保存尺寸/圆角不统一。初版曾尝试把删除改成文字链，已否决——**须保持按钮外形**。

## 目标

- 三个底部控件保持**同高、同圆角、同字号**的按钮形状。
- 删除仍为 danger 语义（浅红底 + 淡红边），但不做成文字链。
- 取消为次要描边按钮；保存保持现有 primary 青绿。
- 布局、文案、confirm 流程不变。

## 非目标

- 不改源文件夹列表与「设为 Primary」。
- 不改其它 modal 的全局 `.modal-actions`（仅作用域 `.project-form-actions`）。

## 设计

### 结构

DOM 不变：删除保留 `className="danger project-form-delete"`；取消无额外语义 class；保存 `primary`。

### 样式（作用域 `.project-form-actions`）

| 控件 | 外形 | 颜色 |
|------|------|------|
| 共用 | `min-height: 34px`、`padding: 0 14px`、`border-radius: 8px`、`font-size: 13px` | — |
| 取消 | 描边按钮 | `border-strong` + `panel-soft` / hover `fb-hover` |
| 删除 | 同尺寸描边按钮 | `fb-danger` 淡底淡边（`color-mix`） |
| 保存 | 同尺寸实心 | 现有 `primary` 渐变，对齐高度与 padding |

## 验收

- 删除仍是圆角矩形按钮，不是文字链。
- 三钮高度/圆角视觉一致。
- confirm 与创建模式行为不变。
