import { CheckCircle2, ChevronLeft, ChevronRight, Download, KeyRound, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { SigningKey, getAddress, isHexString } from "ethers";
import { BOT_CHAIN, CONTRACT_ADDRESS, createProposal, createThresholdProposal, explorerTx, friendlyEvmError, normalizeAddressList, useEvmWallet } from "../lib/evm";
import { generateElectionKit } from "../lib/electionKey";
import { PageHeader } from "../components/PageHeader";

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
  encryptionPublicKey: string;
  tallySecret: string;
  keyCustodyConfirmed: boolean;
};

const creatorSteps = [
  { label: "Decision", detail: "Title and ballot options" },
  { label: "Schedule", detail: "Start and duration" },
  { label: "Privacy", detail: "Mode and committee" },
  { label: "Eligibility", detail: "Voter access and review" }
];

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

function isValidElectionPublicKey(value: string) {
  if (!isHexString(value, 65) || !value.startsWith("0x04")) return false;
  try {
    return SigningKey.computePublicKey(value, false).toLowerCase() === value.toLowerCase();
  } catch {
    return false;
  }
}

export default function Creators() {
  const wallet = useEvmWallet();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [electionPrivateKey, setElectionPrivateKey] = useState("");
  const [recoveryKitDownloaded, setRecoveryKitDownloaded] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    watch,
    trigger,
    setValue,
    getValues,
    clearErrors,
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
      encryptionPublicKey: "",
      tallySecret: "",
      keyCustodyConfirmed: false
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

  const generateKeys = () => {
    try {
      const kit = generateElectionKit();
      setElectionPrivateKey(kit.privateKey);
      setRecoveryKitDownloaded(false);
      setValue("encryptionPublicKey", kit.publicKey, { shouldDirty: true, shouldValidate: true });
      setValue("tallySecret", kit.tallySecret, { shouldDirty: true, shouldValidate: true });
      setValue("keyCustodyConfirmed", false, { shouldDirty: true });
      clearErrors("keyCustodyConfirmed");
      setStatus("idle");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Election key generation failed.");
    }
  };

  const useExternalKey = () => {
    setElectionPrivateKey("");
    setRecoveryKitDownloaded(false);
    setValue("encryptionPublicKey", "", { shouldDirty: true, shouldValidate: true });
    setValue("tallySecret", "", { shouldDirty: true, shouldValidate: true });
    setValue("keyCustodyConfirmed", false, { shouldDirty: true });
    clearErrors("keyCustodyConfirmed");
  };

  const downloadRecoveryKit = () => {
    if (!electionPrivateKey) return;
    const values = getValues();
    const recoveryKit = {
      format: "cipherballot-election-recovery-v1",
      warning: "Anyone with this file can decrypt this proposal's ballots. Store it offline and never upload it to CipherBallot, GitHub, Vercel, or a public drive.",
      createdAt: new Date().toISOString(),
      network: { name: BOT_CHAIN.name, chainId: BOT_CHAIN.chainId },
      contractAddress: CONTRACT_ADDRESS || "not-configured",
      proposalTitle: values.title.trim() || "Untitled proposal",
      encryptionPublicKey: values.encryptionPublicKey.trim(),
      electionPrivateKey,
      committeeTallySecret: values.tallySecret.trim(),
      instructions: [
        "Keep this file offline until the voting deadline has passed.",
        "Use electionPrivateKey with the CipherBallot tally command to decrypt ballot envelopes after the deadline.",
        "Committee members use committeeTallySecret when approving the matching final tally.",
        "Never paste electionPrivateKey into the proposal form or expose it to voters, agents, relayers, or frontend environment variables."
      ]
    };
    const blob = new Blob([JSON.stringify(recoveryKit, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const slug = (values.title || "proposal").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "proposal";
    link.href = url;
    link.download = `cipherballot-${slug}-recovery-kit.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setRecoveryKitDownloaded(true);
    setValue("keyCustodyConfirmed", false, { shouldDirty: true });
    clearErrors("keyCustodyConfirmed");
  };

  const onSubmit = async (data: FormValues) => {
    if (!wallet.connected) return setMessage("Connect wallet first");

    const activeOptions = data.options.map((opt) => opt.value.trim()).filter(Boolean);
    if (activeOptions.length < 2 || activeOptions.length > 8) return setMessage("Use 2 to 8 voting options.");
    if (new Set(activeOptions.map((option) => option.toLocaleLowerCase())).size !== activeOptions.length) {
      return setMessage("Voting options must be unique.");
    }
    if (!data.title.trim() || utf8Length(data.title.trim()) > 160) return setMessage("Proposal title must be 1 to 160 UTF-8 bytes.");
    if (activeOptions.some((option) => utf8Length(option) > 96)) return setMessage("Each voting option must be at most 96 UTF-8 bytes.");

    const formStartsImmediately = data.startsImmediately === true || String(data.startsImmediately) === "true";
    const startDate = formStartsImmediately ? new Date() : new Date(data.scheduledStart);
    const durationDays = Math.max(1, Number(data.durationDays));
    const startTs = Math.floor(startDate.getTime() / 1000);
    const endTs = startTs + durationDays * 24 * 60 * 60;
    if (!Number.isSafeInteger(startTs) || !Number.isSafeInteger(endTs) || endTs <= Math.floor(Date.now() / 1000)) {
      return setMessage("Choose a voting window that ends in the future.");
    }
    
    let allowlist: string[] = [];
    let committee: string[] = [];

    try {
      allowlist = data.eligibility === "allowlist" ? normalizeAddressList(data.allowlistRaw) : [];
      committee = data.privacyMode === "threshold" ? normalizeAddressList(data.committeeRaw) : [];
    } catch {
      return setMessage("One of the address lists contains an invalid EVM address.");
    }
    if (allowlist.length > 128) return setMessage("The voter allowlist cannot exceed 128 addresses.");
    if (committee.length > 16) return setMessage("The committee cannot exceed 16 addresses.");

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
          data.encryptionPublicKey.trim(),
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
      setMessage(friendlyEvmError(err, "Proposal creation failed."));
    }
  };

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>, fieldName: "allowlistRaw" | "committeeRaw") => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 65_536) {
      setStatus("error");
      setMessage("Address imports must be no larger than 64 KB.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const items = text.split(/[\s,]+/).map((i) => i.trim()).filter(Boolean);
      const valids: string[] = [];
      const invalids: string[] = [];
      for (const item of items) {
        try { valids.push(getAddress(item)); } catch { invalids.push(item); }
      }

      if (invalids.length > 0) {
        setStatus("error");
        setMessage(`Import stopped: ${invalids.length} invalid address${invalids.length === 1 ? "" : "es"} found.`);
        event.target.value = "";
        return;
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

  const ErrorMsg = ({ msg }: { msg?: string }) => msg ? <p className="field-error">{msg}</p> : null;

  const advanceStep = async () => {
    const fieldsByStep: Array<Array<keyof FormValues>> = [
      ["title", "options"],
      isStartsImmediately ? ["durationDays"] : ["scheduledStart", "durationDays"],
      watchPrivacyMode === "threshold"
        ? ["privacyMode", "committeeRaw", "threshold", "encryptionPublicKey", "tallySecret", "keyCustodyConfirmed"]
        : ["privacyMode"],
      watchEligibility === "allowlist" ? ["eligibility", "allowlistRaw"] : ["eligibility"]
    ];
    if (await trigger(fieldsByStep[activeStep])) setActiveStep((step) => Math.min(creatorSteps.length - 1, step + 1));
  };

  return (
    <section className="app-page creator-page">
      <PageHeader
        title="Creator studio"
        description="Configure the decision, privacy policy, voting window, and eligibility rules before publishing on BOT Chain."
      />

      <div className="creator-workspace">
        <aside className="creator-stepper" aria-label="Proposal setup steps">
          {creatorSteps.map((step, index) => (
            <button key={step.label} className={activeStep === index ? "active" : ""} onClick={() => setActiveStep(index)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{step.label}</strong><small>{step.detail}</small></div>
            </button>
          ))}
        </aside>

        <form className="creator-form" onSubmit={handleSubmit(onSubmit)}>
          <div className="creator-form-progress">
            <span>Step {activeStep + 1} of {creatorSteps.length}</span>
            <strong>{creatorSteps[activeStep].label}</strong>
          </div>

          {activeStep === 0 && (
            <section className="creator-form-section">
              <div className="form-section-heading"><h2>Define the decision</h2><p>Use a direct title and mutually exclusive ballot options.</p></div>
              <label className="input-label">
                Proposal title
                <input maxLength={160} className={`input ${errors.title ? "input-error" : ""}`} placeholder="Should the DAO fund the Q3 grant pool?" {...register("title", { required: "Title is required", validate: (value) => utf8Length(value.trim()) <= 160 || "Title exceeds 160 UTF-8 bytes" })} />
                <ErrorMsg msg={errors.title?.message} />
              </label>

              <div className="field-label-row"><span>Voting options</span><small>2–8 options</small></div>
              <div className="creator-option-list">
                {fields.map((field, index) => (
                  <div key={field.id} className="creator-option-row">
                    <span>{String.fromCharCode(65 + index)}</span>
                    <input maxLength={96} className={`input ${errors.options?.[index]?.value ? "input-error" : ""}`} placeholder={`Option ${index + 1}`} {...register(`options.${index}.value`, { required: "Option cannot be empty", validate: (value) => utf8Length(value.trim()) <= 96 || "Option exceeds 96 UTF-8 bytes" })} />
                    {fields.length > 2 && <button type="button" className="icon-button" title="Remove option" aria-label={`Remove option ${index + 1}`} onClick={() => remove(index)}><Trash2 size={15} /></button>}
                  </div>
                ))}
              </div>
              {errors.options?.root?.message && <ErrorMsg msg={errors.options.root.message} />}
              <button type="button" className="button-ghost icon-command" onClick={() => append({ value: "" })} disabled={fields.length >= 8}><Plus size={15} /> Add option</button>
            </section>
          )}

          {activeStep === 1 && (
            <section className="creator-form-section">
              <div className="form-section-heading"><h2>Set the voting window</h2><p>Choose when participation opens and how long the vote remains active.</p></div>
              <div className="choice-grid">
                <label className="choice-control"><input type="radio" value="true" {...register("startsImmediately")} /><span><strong>Start immediately</strong><small>Voting opens when the transaction confirms.</small></span></label>
                <label className="choice-control"><input type="radio" value="false" {...register("startsImmediately")} /><span><strong>Schedule</strong><small>Choose a future opening time.</small></span></label>
              </div>
              {!isStartsImmediately && (
                <label className="input-label">Scheduled start<input type="datetime-local" className="input" {...register("scheduledStart", { validate: (value) => isStartsImmediately || !!value || "Scheduled start is required" })} /><ErrorMsg msg={errors.scheduledStart?.message} /></label>
              )}
              <label className="input-label">Duration in days<input className={`input ${errors.durationDays ? "input-error" : ""}`} type="number" min="1" max="3650" step="1" {...register("durationDays", { required: "Duration is required", min: { value: 1, message: "Duration must be at least 1 day" }, max: { value: 3650, message: "Duration cannot exceed 3650 days" } })} /><ErrorMsg msg={errors.durationDays?.message} /></label>
            </section>
          )}

          {activeStep === 2 && (
            <section className="creator-form-section">
              <div className="form-section-heading"><h2>Choose the privacy model</h2><p>Secret-sealed voting is the recommended one-action path. Commit-reveal remains available as a fallback.</p></div>
              <div className="choice-grid">
                <label className="choice-control"><input type="radio" value="threshold" {...register("privacyMode")} /><span><strong>Secret-sealed threshold</strong><small>Encrypted ballots with committee tally approval.</small></span></label>
                <label className="choice-control"><input type="radio" value="commitReveal" {...register("privacyMode")} /><span><strong>Commit-reveal fallback</strong><small>Voters return after the deadline to reveal.</small></span></label>
              </div>

              {watchPrivacyMode === "threshold" && (
                <div className="threshold-fields">
                  <div className="field-label-row"><span>Committee addresses</span><label className="file-command"><Upload size={14} /> Import CSV<input type="file" accept=".csv,.txt" onChange={(event) => handleCsvUpload(event, "committeeRaw")} /></label></div>
                  <textarea className={`input textarea ${errors.committeeRaw ? "input-error" : ""}`} placeholder={"0x123...\n0xabc...\n0xdef..."} rows={5} {...register("committeeRaw", { validate: (value) => { try { return normalizeAddressList(value).length >= 2 || "At least 2 committee addresses required"; } catch { return "Contains invalid EVM address(es)"; } } })} />
                  <ErrorMsg msg={errors.committeeRaw?.message} />
                  <label className="input-label">Threshold approvals required<input className={`input ${errors.threshold ? "input-error" : ""}`} type="number" min="2" {...register("threshold", { validate: (value) => { const count = Number(value); if (!Number.isFinite(count) || count < 2) return "Threshold must be at least 2"; try { return count <= normalizeAddressList(watchCommitteeRaw).length || "Threshold cannot exceed committee size"; } catch { return "Fix committee addresses first"; } } })} /><ErrorMsg msg={errors.threshold?.message} /></label>
                  <div className="election-key-workflow">
                    <div className="election-key-heading">
                      <div><KeyRound size={18} /><span><strong>Election security kit</strong><small>Generated locally in this browser and never uploaded.</small></span></div>
                      <button type="button" className="button-ghost icon-command" onClick={generateKeys}>
                        {electionPrivateKey ? <RefreshCw size={14} /> : <KeyRound size={14} />}
                        {electionPrivateKey ? "Regenerate" : "Generate keys"}
                      </button>
                    </div>

                    <label className="input-label">Election public key<input maxLength={132} className={`input key-material-input ${errors.encryptionPublicKey ? "input-error" : ""}`} readOnly={Boolean(electionPrivateKey)} placeholder="Generate here or paste an externally managed 0x04... key" {...register("encryptionPublicKey", { validate: (value) => watchPrivacyMode !== "threshold" || isValidElectionPublicKey(value.trim()) || "Generate or enter a valid secp256k1 election public key" })} /><ErrorMsg msg={errors.encryptionPublicKey?.message} /></label>
                    <label className="input-label">Committee tally secret<input maxLength={66} className={`input key-material-input ${errors.tallySecret ? "input-error" : ""}`} readOnly={Boolean(electionPrivateKey)} type="password" placeholder="Generated with the kit or supplied by your committee" {...register("tallySecret", { validate: (value) => watchPrivacyMode !== "threshold" || /^0x[0-9a-fA-F]{64}$/.test(value.trim()) || "Use a cryptographically random 32-byte hex tally secret" })} /><ErrorMsg msg={errors.tallySecret?.message} /></label>

                    {electionPrivateKey ? (
                      <div className="recovery-kit-actions">
                        <div className="recovery-kit-status"><CheckCircle2 size={16} /><span><strong>Keys generated</strong><small>The private key exists only in this page until you download it.</small></span></div>
                        <div>
                          <button type="button" className="cta icon-command" onClick={downloadRecoveryKit}><Download size={15} /> {recoveryKitDownloaded ? "Download again" : "Download recovery kit"}</button>
                          <button type="button" className="button-ghost" onClick={useExternalKey}>Use existing key</button>
                        </div>
                      </div>
                    ) : (
                      <p className="external-key-note">Advanced custody: you may paste a public key generated outside CipherBallot. You must control its matching private key.</p>
                    )}

                    <label className={`key-custody-confirmation ${errors.keyCustodyConfirmed ? "has-error" : ""}`}>
                      <input type="checkbox" {...register("keyCustodyConfirmed", { validate: (value) => {
                        if (watchPrivacyMode !== "threshold") return true;
                        if (electionPrivateKey && !recoveryKitDownloaded) return "Download the recovery kit before continuing";
                        return value || (electionPrivateKey ? "Confirm that the recovery kit is stored safely" : "Confirm that you control the matching private key");
                      } })} />
                      <span><strong>{electionPrivateKey ? "I downloaded and safely stored the recovery kit" : "I control the matching election private key"}</strong><small>{electionPrivateKey ? "Losing it makes encrypted ballots impossible to tally." : "CipherBallot cannot recover an externally managed private key."}</small></span>
                    </label>
                    <ErrorMsg msg={errors.keyCustodyConfirmed?.message} />
                  </div>
                </div>
              )}
            </section>
          )}

          {activeStep === 3 && (
            <section className="creator-form-section">
              <div className="form-section-heading"><h2>Set voter eligibility</h2><p>Open participation to every address or restrict submissions to a reviewed address list.</p></div>
              <div className="choice-grid">
                <label className="choice-control"><input type="radio" value="public" {...register("eligibility")} /><span><strong>Public vote</strong><small>Any EVM address can submit a ballot.</small></span></label>
                <label className="choice-control"><input type="radio" value="allowlist" {...register("eligibility")} /><span><strong>Allowlist</strong><small>Only listed addresses can participate.</small></span></label>
              </div>
              {watchEligibility === "allowlist" && (
                <div className="threshold-fields">
                  <div className="field-label-row"><span>Allowed voter addresses</span><label className="file-command"><Upload size={14} /> Import CSV<input type="file" accept=".csv,.txt" onChange={(event) => handleCsvUpload(event, "allowlistRaw")} /></label></div>
                  <textarea className={`input textarea ${errors.allowlistRaw ? "input-error" : ""}`} placeholder={"0x123...\n0xabc..."} rows={6} {...register("allowlistRaw", { validate: (value) => { try { return normalizeAddressList(value).length > 0 || "Add at least one valid voter address"; } catch { return "Contains invalid EVM address(es)"; } } })} />
                  <ErrorMsg msg={errors.allowlistRaw?.message} />
                </div>
              )}
              <div className="creator-review-strip"><span>Privacy</span><strong>{watchPrivacyMode === "threshold" ? "Secret-sealed threshold" : "Commit-reveal"}</strong><span>Access</span><strong>{watchEligibility === "public" ? "Public" : "Allowlist"}</strong></div>
            </section>
          )}

          <div className="creator-form-actions">
            <button type="button" className="button-ghost icon-command" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}><ChevronLeft size={16} /> Back</button>
            {activeStep < creatorSteps.length - 1 ? (
              <button type="button" className="cta icon-command" onClick={() => void advanceStep()}>Continue <ChevronRight size={16} /></button>
            ) : (
              <button type="submit" className="cta" disabled={status === "sending"}>{status === "sending" ? "Creating..." : "Create proposal"}</button>
            )}
          </div>

          {message && <div className={`feedback-msg ${status === "success" ? "done" : status === "error" ? "error" : ""}`}>{message}{txHash && <> <a href={explorerTx(txHash)} target="_blank" rel="noreferrer">View transaction</a></>}</div>}
        </form>
      </div>
    </section>
  );
}
