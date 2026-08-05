## 下载安装包

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS Apple Silicon | `FreeBuddy_macOS-Apple-Silicon-{{version}}.dmg` | M 系列芯片 Mac |
| macOS Intel | `FreeBuddy_macOS-Intel-{{version}}.dmg` | Intel 芯片 Mac |
| Windows | `FreeBuddy_Windows_x64-{{version}}.exe` | Windows 10/11 64 位 |
| Ubuntu / Debian (x64) | `FreeBuddy_Ubuntu_x64-{{version}}.deb` | Ubuntu 22.04/24.04 及 Debian 系发行版 |
| Linux AppImage (x64) | `FreeBuddy_Linux_x64-{{version}}.AppImage` | 免安装的通用 Linux 包 |

### macOS 安装提示

如果提示无法打开，请在终端执行：

```bash
xattr -cr /Applications/FreeBuddy.app
```

### Windows 安装提示

如果 SmartScreen 弹出警告，点击「更多信息」后选择「仍要运行」。

### Ubuntu / Linux 安装提示

Ubuntu / Debian 推荐安装 DEB：

```bash
sudo apt install ./FreeBuddy_Ubuntu_x64-{{version}}.deb
```

AppImage 下载后可直接授权运行：

```bash
chmod +x FreeBuddy_Linux_x64-{{version}}.AppImage
./FreeBuddy_Linux_x64-{{version}}.AppImage
```
