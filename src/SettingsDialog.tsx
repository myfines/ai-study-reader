import { useEffect, useState } from "react";
import { defaultSettings, supportsImages, type AISettings } from "./ai";
import { loadSettings, saveSettings, deleteKey } from "./chatStore";
import { desktop } from "./store";
export function SettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [s, setS] = useState<AISettings>(defaultSettings);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadSettings()
      .then((v) => {
        setS(v.settings);
        setHasKey(v.hasKey);
      })
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <div className="modal-shade">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI 设置"
        className="settings-dialog"
      >
        <div className="dialog-title">
          <h2>AI 接口设置</h2>
          <button onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </div>
        <p>
          阅读与批注完全离线可用。点击发送时，所选内容才会提交给配置的 AI 服务。
        </p>
        <label>
          API 地址
          <input
            value={s.baseUrl}
            onChange={(e) => {
              setS({ ...s, baseUrl: e.target.value });
              setHasKey(false);
            }}
            placeholder="https://api.deepseek.com"
          />
        </label>
        <label>
          模型名称
          <input
            value={s.model}
            onChange={(e) => setS({ ...s, model: e.target.value })}
          />
        </label>
        <div className="presets">
          <button
            onClick={() =>
              setS({
                ...s,
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-flash",
                vision: true,
              })
            }
          >
            DeepSeek 视觉
          </button>
          <button
            onClick={() =>
              setS({
                ...s,
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-chat",
                vision: false,
              })
            }
          >
            DeepSeek 纯文字
          </button>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={s.vision}
            onChange={(e) => setS({ ...s, vision: e.target.checked })}
          />
          自定义接口已确认支持图片（仅适用于非 DeepSeek 模型）
        </label>
        <p className="model-capability">
          {supportsImages(s)
            ? "此模型可发送区域截图"
            : "此模型仅发送文字，不会上传截图"}
        </p>
        <label>
          API Key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? "已安全保存；留空保留" : "输入 API Key"}
          />
        </label>
        <small>
          {desktop
            ? "保存在 Windows 凭据管理器，按接口地址隔离；不进入数据库。"
            : "浏览器预览不能保存 Key 或调用 AI，请使用桌面版。"}
        </small>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            disabled={busy || !desktop}
            onClick={async () => {
              try {
                await deleteKey(s);
                setHasKey(false);
                setKey("");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            删除此接口 Key
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await saveSettings(s, key);
                setKey("");
                onSaved();
                onClose();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            保存设置
          </button>
        </div>
      </section>
    </div>
  );
}
