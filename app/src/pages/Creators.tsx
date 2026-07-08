import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { getAddress } from "ethers";
import { createProposal, createThresholdProposal, explorerTx, normalizeAddressList, useEvmWallet } from "../lib/evm";

function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type FormValues = {
  title: string;
  options: { value: string }[];
  startsImmediately: boolean;
  scheduledStart: string;
  durationDays: number;
  privacyMode: "threshold" | "commitReveal";
  eligibility: "public" | "allowlist";
  allowlistRaw: string;
  committeeRaw: string;
  threshold: number;
  tallySecret: string;
};

export default function Creators() {
  const wallet = useEvmWallet();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors }
  } = useForm<FormValues>({
    mode: "onBlur",
    defaultValues: {
      title: "",
      options: [{ value: "Yes" }, { value: "No" }, { value: "Abstain" }],
      startsImmediately: true,
      scheduledStart: toLocalDatetimeInputValue(new Date()),
      durationDays: 3,
      privacyMode: "threshold",
      eligibility: "public",
      allowlistRaw: "",
      committeeRaw: "",
      threshold: 2,
      tallySecret: ""
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "options"
  });

  const watchStartsImmediately = watch("startsImmediately");
  const isStartsImmediately = watchStartsImmediately === true || String(watchStartsImmediately) === "true";
  const watchPrivacyMode = watch("privacyMode");
  const watchEligibility = watch("eligibility");
  const watchCommitteeRaw = watch("committeeRaw");

  const onSubmit = async (data: FormValues) => {
    if (!wallet.connected) return setMessage("Connect wallet first");

    const activeOptions = data.options.map((opt) => opt.value.trim()).filter(Boolean);
    if (activeOptions.length < 2 || activeOptions.length > 8) return setMessage("Use 2 to 8 voting options.");

    const formStartsImmediately = data.startsImmediately === true || String(data.startsImmediately) === "true";
    const startDate = formStartsImmediately ? new Date() : new Date(data.scheduledStart);
    const durationDays = Math.max(1, Number(data.durationDays));
    const startTs = Math.floor(startDate.getTime() / 1000);
    const endTs = startTs + durationDays * 24 * 60 * 60;
    
    let allowlist: string[] = [];
    let committee: string[] = [];

    try {
      allowlist = data.eligibility === "allowlist" ? normalizeAddressList(data.allowlistRaw) : [];
      committee = data.privacyMode === "threshold" ? normalizeAddressList(data.committeeRaw) : [];
    } catch {
      return setMessage("One of the address lists contains an invalid EVM address.");
    }

    const thresholdCount = Math.max(0, Number(data.threshold));

    try {
      setStatus("sending");
      setMessage("Creating BOT Chain proposal...");
      const contract = await wallet.getSignerContract();
      const hash = data.privacyMode === "threshold"
        ? await createThresholdProposal(
          contract,
          data.title.trim(),
          activeOptions,
          startTs,
          endTs,
          allowlist,
          committee,
          thresholdCount,
          data.tallySecret.trim()
        )
        : await createProposal(contract, data.title.trim(), activeOptions, startTs, endTs, allowlist);
      setTxHash(hash);
      setStatus("success");
      setMessage("Proposal created on BOT Chain. Redirecting to Voters dashboard...");
      setTimeout(() => {
        navigate("/voters");
      }, 1500);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Proposal creation failed");
    }
  };

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>, fieldName: "allowlistRaw" | "committeeRaw") => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const items = text.split(/[\s,]+/).map((i) => i.trim()).filter(Boolean);
      const valids: string[] = [];
      
      for (const item of items) {
        try {
          valids.push(getAddress(item));
        } catch {
          // Skip invalid ones silently for the CSV import
        }
      }

      if (valids.length > 0) {
        const currentVal = getValues(fieldName);
        const prefix = currentVal && currentVal.trim() !== "" ? currentVal.trim() + "\n" : "";
        setValue(fieldName, prefix + valids.join("\n"), { shouldValidate: true, shouldDirty: true });
      }
      
      // Reset input value to allow uploading the same file again if needed
      event.target.value = "";
    };
    reader.readAsText(file);
  };

  // Helper component for error messages
  const ErrorMsg = ({ msg }: { msg?: string }) => msg ? <p style={{ color: "#e74c3c", fontSize: "13px", marginTop: "4px" }}>{msg}</p> : null;

  return (
    <section className="wizard-view">
      <div className="voters-header">
        <div>
          <h3 className="section-title">Creator Studio</h3>
          <p className="hero-copy" style={{ fontSize: "16px", margin: 0, opacity: 0.7 }}>
            Create a private voting proposal on BOT Chain.
          </p>
        </div>
      </div>

      <div className="proposal-card wizard-card">
        <div className="wizard-step-content">
          <form onSubmit={handleSubmit(onSubmit)}>
            <h4>Proposal Basics</h4>
            <label className="input-label">
              Title
              <input
                className={`input ${errors.title ? "input-error" : ""}`}
                style={errors.title ? { borderColor: "#e74c3c" } : {}}
                placeholder="e.g. Should the DAO fund the Q3 grant pool?"
                {...register("title", { required: "Title is required" })}
              />
              <ErrorMsg msg={errors.title?.message} />
            </label>

            <h4>Voting Options</h4>
            <div className="option-list">
              {fields.map((field, index) => (
                <div key={field.id} className="option-row" style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <span className="option-label" style={{ alignSelf: "center", width: "24px", opacity: 0.5 }}>#{index + 1}</span>
                  <input
                    className={`input option-input ${errors.options?.[index]?.value ? "input-error" : ""}`}
                    style={{ flex: 1, ...(errors.options?.[index]?.value ? { borderColor: "#e74c3c" } : {}) }}
                    placeholder={`Option ${index + 1}`}
                    {...register(`options.${index}.value`, { required: "Option cannot be empty" })}
                  />
                  {fields.length > 2 && (
                    <button type="button" className="button-ghost icon-only" onClick={() => remove(index)}>
                      x
                    </button>
                  )}
                </div>
              ))}
            </div>
            {errors.options?.root?.message && <ErrorMsg msg={errors.options.root.message} />}
            <button
              type="button"
              className="button-ghost full-width"
              onClick={() => append({ value: "" })}
              disabled={fields.length >= 8}
            >
              + Add Option
            </button>

            <h4>Voting Window</h4>
            <div className="form-group">
              <div className="inline-options">
                <label className="radio-row">
                  <input type="radio" value="true" {...register("startsImmediately")} />
                  Start Immediately
                </label>
                <label className="radio-row">
                  <input type="radio" value="false" {...register("startsImmediately")} />
                  Schedule
                </label>
              </div>
              {!isStartsImmediately && (
                <input
                  type="datetime-local"
                  className="input"
                  style={{ marginTop: "8px" }}
                  {...register("scheduledStart", {
                    validate: (val) => isStartsImmediately || !!val || "Scheduled start is required"
                  })}
                />
              )}
              {!isStartsImmediately && <ErrorMsg msg={errors.scheduledStart?.message} />}
            </div>

            <label className="input-label" style={{ marginTop: "24px" }}>
              Duration (Days)
              <input
                className={`input ${errors.durationDays ? "input-error" : ""}`}
                type="number"
                min="1"
                step="1"
                style={errors.durationDays ? { borderColor: "#e74c3c" } : {}}
                {...register("durationDays", {
                  required: "Duration is required",
                  min: { value: 1, message: "Duration must be at least 1 day" }
                })}
              />
              <ErrorMsg msg={errors.durationDays?.message} />
            </label>

            <h4>Privacy Mode</h4>
            <div className="form-group">
              <div className="inline-options">
                <label className="radio-row">
                  <input type="radio" value="threshold" {...register("privacyMode")} />
                  Secret-sealed threshold
                </label>
                <label className="radio-row">
                  <input type="radio" value="commitReveal" {...register("privacyMode")} />
                  Commit-reveal fallback
                </label>
              </div>
              {watchPrivacyMode === "threshold" && (
                <div style={{ marginTop: "12px" }}>
                  <label className="input-label">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <span>Committee addresses</span>
                      <label style={{ cursor: "pointer", color: "#3498db", fontSize: "13px" }}>
                        + Import CSV
                        <input
                          type="file"
                          accept=".csv,.txt"
                          style={{ display: "none" }}
                          onChange={(e) => handleCsvUpload(e, "committeeRaw")}
                        />
                      </label>
                    </div>
                    <textarea
                      className={`input textarea ${errors.committeeRaw ? "input-error" : ""}`}
                      style={errors.committeeRaw ? { borderColor: "#e74c3c" } : {}}
                      placeholder="0x123...&#10;0xabc...&#10;0xdef..."
                      rows={4}
                      {...register("committeeRaw", {
                        validate: (value) => {
                          try {
                            const list = normalizeAddressList(value);
                            if (list.length < 2) return "At least 2 committee addresses required";
                            return true;
                          } catch {
                            return "Contains invalid EVM address(es)";
                          }
                        }
                      })}
                    />
                    <ErrorMsg msg={errors.committeeRaw?.message} />
                  </label>
                  
                  <label className="input-label">
                    Threshold approvals required
                    <input
                      className={`input ${errors.threshold ? "input-error" : ""}`}
                      type="number"
                      min="2"
                      style={errors.threshold ? { borderColor: "#e74c3c" } : {}}
                      {...register("threshold", {
                        validate: (val) => {
                          const count = parseInt(String(val), 10);
                          if (isNaN(count) || count < 2) return "Threshold must be at least 2";
                          try {
                            const list = normalizeAddressList(watchCommitteeRaw);
                            if (count > list.length) return "Threshold cannot exceed committee size";
                          } catch {
                            return "Fix committee addresses first";
                          }
                          return true;
                        }
                      })}
                    />
                    <ErrorMsg msg={errors.threshold?.message} />
                  </label>

                  <label className="input-label">
                    Committee tally secret
                    <input
                      className={`input ${errors.tallySecret ? "input-error" : ""}`}
                      type="password"
                      style={errors.tallySecret ? { borderColor: "#e74c3c" } : {}}
                      placeholder="Shared by the committee after voting closes"
                      {...register("tallySecret", {
                        validate: (val) => !!val.trim() || "Tally secret is required"
                      })}
                    />
                    <ErrorMsg msg={errors.tallySecret?.message} />
                  </label>
                </div>
              )}
            </div>

            <h4>Eligibility</h4>
            <div className="form-group">
              <div className="inline-options">
                <label className="radio-row">
                  <input type="radio" value="public" {...register("eligibility")} />
                  Public
                </label>
                <label className="radio-row">
                  <input type="radio" value="allowlist" {...register("eligibility")} />
                  Allowlist
                </label>
              </div>
              {watchEligibility === "allowlist" && (
                <label className="input-label" style={{ marginTop: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <span>Allowed voter addresses</span>
                    <label style={{ cursor: "pointer", color: "#3498db", fontSize: "13px" }}>
                      + Import CSV
                      <input
                        type="file"
                        accept=".csv,.txt"
                        style={{ display: "none" }}
                        onChange={(e) => handleCsvUpload(e, "allowlistRaw")}
                      />
                    </label>
                  </div>
                  <textarea
                    className={`input textarea ${errors.allowlistRaw ? "input-error" : ""}`}
                    style={errors.allowlistRaw ? { borderColor: "#e74c3c" } : {}}
                    placeholder="0x123...&#10;0xabc..."
                    rows={5}
                    {...register("allowlistRaw", {
                      validate: (value) => {
                        try {
                          const list = normalizeAddressList(value);
                          if (list.length === 0) return "Add at least one valid voter address";
                          return true;
                        } catch {
                          return "Contains invalid EVM address(es)";
                        }
                      }
                    })}
                  />
                  <ErrorMsg msg={errors.allowlistRaw?.message} />
                </label>
              )}
            </div>

            <div className="actions wizard-actions">
              <button type="submit" className="cta full-width" disabled={status === "sending"}>
                {status === "sending" ? "Creating..." : "Create Proposal"}
              </button>
            </div>

            {message && (
              <div className={`feedback-msg ${status === "success" ? "done" : status === "error" ? "error" : ""}`}>
                {message}
                {txHash && (
                  <>
                    {" "}
                    <a href={explorerTx(txHash)} target="_blank" rel="noreferrer">View transaction</a>
                  </>
                )}
              </div>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}

