"use client";

import { DocsLayout } from "@/components/docs/DocsLayout";
import {
  DocSection, H3, P, BulletList, NumberedList, Table,
  Steps, InfoBox, Warning, Badge,
} from "@/components/docs/DocComponents";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "ai-chat", label: "AI Chat" },
  { id: "full-diagnosis", label: "Full Diagnosis" },
  { id: "what-ai-knows", label: "What the AI Knows" },
  { id: "what-ai-doesnt", label: "What the AI Doesn't Know" },
  { id: "better-answers", label: "Getting Better Answers" },
  { id: "aftertreatment", label: "Aftertreatment Guide" },
  { id: "cost-estimates", label: "Cost Estimates" },
  { id: "ethics", label: "Ethical Boundaries" },
  { id: "diagnostic-rules", label: "Diagnostic Rules Engine" },
  { id: "tips", label: "Tips for New Users" },
] as const;

export default function AiDocsPage() {
  return (
    <DocsLayout
      title="AI Diagnostics — User Guide"
      subtitle="How IronSight's AI diagnostic system works — what it sees, how to use it, and what to expect."
      sections={sections}
    >
      <DocSection id="overview" title="Overview">
        <P>
          IronSight includes an AI-powered diagnostic system that helps mechanics analyze vehicle data.
          The AI (powered by Claude) acts as a <strong>diagnostic partner</strong> — a knowledgeable
          colleague sitting next to you at the shop, looking at live data together. It is not an oracle
          that gives definitive answers. It presents possibilities, asks questions, and helps you work
          through problems collaboratively.
        </P>
        <H3>Three ways to use AI</H3>
        <Table
          headers={["Feature", "Where", "What It Does"]}
          rows={[
            ["AI Chat", "Truck dashboard", "Conversational diagnostics — ask anything about the truck's data"],
            ["Full Diagnosis", "Truck dashboard", "One-click comprehensive analysis with structured 6-section report"],
            ["@ai in Chat", "Team chat threads", "Mention @ai in any chat thread for inline diagnostic input"],
          ]}
        />
      </DocSection>

      <DocSection id="ai-chat" title="AI Chat">
        <P>
          Open the AI chat from any truck dashboard by clicking &quot;Ask AI.&quot; The AI receives
          live sensor readings with every message, so it always sees the truck&apos;s current state.
        </P>
        <H3>Quick questions</H3>
        <P>
          On first open, six suggested questions appear to help you get started:
        </P>
        <BulletList
          items={[
            "\"What could be causing these trouble codes?\"",
            "\"Walk me through what the data is showing right now\"",
            "\"What should I check first based on these readings?\"",
            "\"Are there any readings trending in a bad direction?\"",
            "\"Explain the fuel trim readings\"",
            "\"What questions should I be asking about this vehicle's history?\"",
          ]}
        />
        <H3>How it works</H3>
        <NumberedList
          items={[
            "Click \"Ask AI\" on the truck dashboard",
            "Type a question or click a suggested question",
            "The AI receives: your question + live readings + 24-hour trends + DTC history + activity data",
            "It responds with data analysis, possible causes, and follow-up questions",
            "Continue the conversation — provide context about recent repairs, symptoms, or conditions",
            "Each message includes the latest live readings, so the AI's analysis stays current",
          ]}
        />
        <H3>@ai in team chat</H3>
        <P>
          In any team chat thread, mention @ai to get diagnostic input. The AI receives the last
          10 messages in the thread plus a sensor snapshot from when the message was sent. Responses
          are shorter and more conversational than the truck dashboard AI — optimized for group chat.
        </P>
        <InfoBox title="Context matters">
          The AI gives better answers when you include the thread&apos;s truck or work order context.
          Starting a chat from a truck&apos;s chat tab automatically anchors the thread to that truck,
          giving the AI more relevant data.
        </InfoBox>
      </DocSection>

      <DocSection id="full-diagnosis" title="Full Diagnosis">
        <P>
          Click &quot;Full Diagnosis&quot; on the truck dashboard for a comprehensive one-shot analysis.
          The AI produces a structured report with six sections:
        </P>
        <H3>Report structure</H3>
        <NumberedList
          items={[
            "DATA SUMMARY — What the vehicle is telling us right now. Current readings, historical trends, utilization data (trips, engine hours, idle %, estimated miles).",
            "ACTIVE TROUBLE CODES — For each code: plain-English meaning, 3-4 likely causes ranked by probability, severity, estimated repair cost, urgency assessment, and diagnostic questions.",
            "ENGINE HEALTH ASSESSMENT — Temperatures, pressures, fuel trims, battery, aftertreatment. Compares live readings to 24-hour trends and 7-day baselines. Flags anything marked ALERT or watch.",
            "WHAT I'D WANT TO KNOW — 3-5 diagnostic questions the data can't answer (recent repairs, symptoms, driver reports, environmental conditions).",
            "MAINTENANCE RECOMMENDATIONS — Three tiers: immediate (do now), soon (within 2 weeks), at next service.",
            "FLEET NOTE — If this were one truck in a fleet of 36, what would flag for the fleet manager?",
          ]}
        />
        <H3>When to use Full Diagnosis vs. Chat</H3>
        <Table
          headers={["Use Full Diagnosis When", "Use Chat When"]}
          rows={[
            ["You want a complete health check", "You have a specific question"],
            ["Starting a diagnostic workup on a truck", "Following up on a known issue"],
            ["Generating a report for a manager", "Discussing findings with the AI"],
            ["You don't know where to start", "You want to explore a particular reading"],
          ]}
        />
      </DocSection>

      <DocSection id="what-ai-knows" title="What the AI Knows">
        <P>
          The AI receives extensive data with every interaction. Here is the complete list
          of what it can see:
        </P>
        <H3>Live readings (real-time)</H3>
        <BulletList
          items={[
            "Engine: RPM, temperatures (coolant, oil, intake, fuel), pressures (oil, fuel, boost)",
            "Battery voltage, engine load, accelerator position, torque",
            "Fuel level, fuel trims (short-term and long-term), fuel rate, economy",
            "Aftertreatment: SCR temp, SCR efficiency, DEF level, DEF dose rate, DPF soot load, DPF temps",
            "NOx sensor readings (inlet/outlet) with status flags (power, temp, stability)",
            "Transmission: gear, oil temp, output RPM",
            "Brakes: pedal position, ABS active, air pressure",
            "Warning lamp status: MIL, Stop, Warning, Protect (from both Engine ECM and ACM)",
            "Active DTC codes with SPN, FMI, ECU source, and occurrence count",
          ]}
        />
        <H3>Historical data (24-hour window)</H3>
        <BulletList
          items={[
            "24-hour trends for 16 key metrics: recent value, 24h average, min/max, 7-day baseline",
            "Trend direction: rising, falling, or stable (computed from first half vs. second half of 24h)",
            "Status flags: ALERT (outside normal range), watch (>15% deviation from 7-day baseline), normal",
            "Peak events: highest coolant/oil temps, lowest battery voltage, highest DPF soot, lowest DEF",
          ]}
        />
        <H3>Activity data (7-day window)</H3>
        <BulletList
          items={[
            "Trip count, start/end times, durations, max/average speeds per trip",
            "Estimated miles driven (speed × time integration)",
            "Total engine hours, idle hours, idle percentage",
            "Maximum speed achieved",
          ]}
        />
        <H3>DTC history (48-hour window)</H3>
        <P>
          All trouble codes that appeared and cleared in the last 48 hours, with first-seen timestamps.
          This is critical for identifying intermittent issues.
        </P>
      </DocSection>

      <DocSection id="what-ai-doesnt" title="What the AI Doesn't Know">
        <BulletList
          items={[
            "GPS locations — the AI sees estimated miles and trip patterns, not coordinates",
            "Video or camera feeds — no visual inspection capability",
            "Previous repair history — unless you tell it about recent work",
            "Driver behavior — only inferred from speed patterns and idle data",
            "Physical condition — can't see rust, leaks, worn belts, or damaged wiring",
            "Parts availability or your shop's inventory",
            "Your company's specific maintenance schedule or SOPs",
          ]}
        />
        <InfoBox title="This is why conversation matters">
          The more context you provide — recent repairs, driving conditions, symptoms, truck
          history — the better the AI&apos;s analysis becomes. The AI is designed to ask you for
          this information because it knows it can&apos;t see everything.
        </InfoBox>
      </DocSection>

      <DocSection id="better-answers" title="Getting Better Answers">
        <H3>Tell the AI about context</H3>
        <BulletList
          items={[
            "\"We just replaced the turbo 500 miles ago\" — AI will factor in break-in period",
            "\"This truck runs mountain routes in 100°F weather\" — higher temps may be expected",
            "\"The DEF tank was just filled yesterday\" — rules out low DEF as a cause",
            "\"We've been seeing this code come and go for two weeks\" — AI will focus on intermittent causes",
          ]}
        />
        <H3>Ask follow-up questions</H3>
        <P>
          The AI ends every response with 2-3 suggested follow-up questions. These are
          genuinely useful diagnostic questions, not filler — they help narrow down root
          causes based on the data pattern the AI sees.
        </P>
        <H3>Start broad, then focus</H3>
        <NumberedList
          items={[
            "Start with: \"What do you see?\" — let the AI summarize the overall picture",
            "Then: Give context — \"This truck has been sitting for a week\" or \"We just did an oil change\"",
            "Then: Ask specifics — \"Why is the SCR efficiency dropping?\" or \"Should I be worried about that oil pressure?\"",
            "Then: Use the AI's follow-up questions to dig deeper",
          ]}
        />
        <Warning>
          Don&apos;t trust the AI blindly. You know the truck. The AI knows the data. Together you
          make better decisions than either alone.
        </Warning>
      </DocSection>

      <DocSection id="aftertreatment" title="Aftertreatment System Guide">
        <P>
          The aftertreatment system (SCR, DPF, DEF) is the most complex subsystem on modern diesel
          trucks and the most common source of diagnostic issues. The AI has deep knowledge of how
          these systems work and fail.
        </P>
        <H3>How it works</H3>
        <Table
          headers={["Component", "Function", "Normal Range"]}
          rows={[
            ["SCR (Selective Catalytic Reduction)", "Converts NOx emissions using DEF fluid", "Efficiency 85–99%"],
            ["DPF (Diesel Particulate Filter)", "Captures soot from exhaust", "Soot load < 80%"],
            ["DEF (Diesel Exhaust Fluid)", "Urea solution injected into SCR", "Level > 10%"],
            ["NOx Sensors", "Measure emissions before/after SCR", "All status flags = true"],
          ]}
        />
        <H3>Common cascade failure</H3>
        <P>
          The most common aftertreatment failure follows a predictable chain. Understanding this
          pattern helps you diagnose issues faster:
        </P>
        <Steps
          items={[
            { label: "SCR Temp Lost", desc: "Temperature sensor fails or loses signal" },
            { label: "DEF Disabled", desc: "ECU disables DEF dosing (can't verify safe catalyst temp)" },
            { label: "Efficiency Drops", desc: "SCR efficiency collapses below 50%" },
            { label: "EPA Inducement", desc: "Protect Lamp → 5 mph derate → idle-only" },
          ]}
        />
        <H3>EPA inducement stages</H3>
        <Table
          headers={["Stage", "What Happens", "Urgency"]}
          rows={[
            ["Stage 1", "Protect Lamp on — no performance impact yet", "Schedule repair within a few days"],
            ["Stage 2", "5 mph speed derate — truck can barely move", "Urgent repair needed"],
            ["Stage 3", "Idle only — truck cannot drive at all", "Immediate repair required"],
          ]}
        />
        <P>
          Stages escalate with engine hours. A truck at Stage 1 will progress to Stage 2 and then
          Stage 3 if the underlying cause is not resolved.
        </P>
        <H3>Protect Lamp + zero DTCs</H3>
        <P>
          If the Protect Lamp comes back on immediately after clearing DTCs, and the DTC panel shows
          zero active codes, the ECU is reasserting the lamp because the underlying condition persists.
          Clearing codes alone will not fix this — the root cause must be resolved.
        </P>
        <H3>DPF regeneration</H3>
        <BulletList
          items={[
            "DPF soot < 70%: normal operation, passive regen handles it",
            "DPF soot 70–80%: elevated, system will attempt active regen soon",
            "DPF soot 80–90%: high, needs active regen",
            "DPF soot > 90%: critically high, may need forced regen with scan tool",
            "If DEF dosing is disabled, soot will climb until dosing is restored",
          ]}
        />
      </DocSection>

      <DocSection id="cost-estimates" title="Cost Estimates">
        <P>
          The AI provides repair cost estimates when diagnosing trouble codes. These include:
        </P>
        <BulletList
          items={[
            "Parts cost range (common aftermarket and OEM prices)",
            "Labor estimate (hours × typical shop rate)",
            "Whether it's a DIY job or requires a shop",
            "Whether it can wait or needs immediate attention",
            "Total estimated cost range for each likely cause",
          ]}
        />
        <Warning>
          Cost estimates are generated by AI based on typical repair costs. Your actual costs
          may vary based on parts availability, local labor rates, and the specific vehicle.
          Use these as a rough guide, not a quote.
        </Warning>
      </DocSection>

      <DocSection id="ethics" title="Ethical Boundaries">
        <P>
          The AI diagnostic system operates within strict ethical boundaries:
        </P>
        <BulletList
          items={[
            "The AI will NEVER say a vehicle is \"safe to drive\" or \"unsafe to drive\" — that is the mechanic's professional judgment",
            "The AI will not blame previous repair work without explicit request and full context",
            "The AI presents data analysis and possibilities, not certainties — you make the decisions",
            "The AI says \"this COULD indicate\" not \"this IS caused by\"",
            "The AI will update its assessment when you provide new information",
            "If the AI doesn't know something, it says so — it doesn't guess",
          ]}
        />
        <InfoBox title="Why these boundaries matter">
          The AI is a diagnostic tool, not a decision-maker. You are the mechanic. You have
          professional training, hands-on experience, and physical access to the vehicle.
          The AI has data analysis capabilities and broad knowledge. The best outcomes come
          from combining both — the AI spots patterns in data, and you apply professional
          judgment.
        </InfoBox>
      </DocSection>

      <DocSection id="diagnostic-rules" title="Diagnostic Rules Engine">
        <P>
          In addition to AI-powered chat, IronSight runs 19 automated diagnostic rules on every
          1 Hz reading. These rules detect common TPS (Tie Plate System) issues and produce
          operator-friendly alerts with step-by-step actions.
        </P>
        <H3>Rule categories</H3>
        <Table
          headers={["Category", "Rules", "What They Detect"]}
          rows={[
            ["Camera (Plate Flipper)", "4 rules", "Detection degrading, sudden loss, intermittent signal, no ties present"],
            ["Encoder", "7 rules", "Disconnected, spinning without distance, stopped, unexpected motion, speed mismatch, noise, drift"],
            ["Eject System", "2 rules", "No Air Eagle confirmation, plates not dropping"],
            ["PLC Communication", "2 rules", "Slow response, frequent errors"],
            ["Operation", "4 rules", "Wrong spacing, backward travel, drops disabled, no mode selected"],
          ]}
        />
        <H3>Severity levels</H3>
        <Table
          headers={["Severity", "Meaning", "Examples"]}
          rows={[
            ["Critical", "Stop and investigate immediately", "Encoder disconnected, eject not firing, drops disabled while moving"],
            ["Warning", "Needs attention soon", "Flipper intermittent, speed mismatch, PLC errors, backward travel"],
            ["Info", "Monitor, may be normal", "Non-standard spacing, no ties present (may be crossing/switch)"],
          ]}
        />
        <P>
          Each rule produces an alert with a plain-English title, evidence from the data, and
          step-by-step operator actions. These feed into the AI system as pre-processed diagnostic
          notes, helping the AI provide more targeted analysis.
        </P>
      </DocSection>

      <DocSection id="tips" title="Tips for New Users">
        <H3>If you&apos;re a mechanic new to AI diagnostics</H3>
        <NumberedList
          items={[
            "Start with \"What do you see?\" — let the AI give you the overall picture before you ask specifics",
            "Give the AI context about the truck — recent repairs, known issues, driving conditions",
            "Use the suggested follow-up questions — they're designed to narrow down root causes",
            "Don't trust blindly — you know the truck better than any AI. Use it as a second opinion.",
            "If the AI says something that contradicts your experience, tell it. It will adjust.",
            "The AI is best at spotting patterns in data that might take hours to notice manually",
            "For aftertreatment issues, the AI knows the cascade failure chains — ask about the chain, not just one code",
          ]}
        />
        <H3>If you&apos;re a fleet manager</H3>
        <BulletList
          items={[
            "Use Full Diagnosis to get a structured health report for any truck",
            "The Fleet Note section of each diagnosis identifies what matters for fleet-level decisions",
            "24-hour trends reveal developing issues before they become critical",
            "DTC history shows intermittent issues that may not be active right now",
            "Activity data (trips, idle %, speeds) gives insight into truck utilization",
          ]}
        />
      </DocSection>
    </DocsLayout>
  );
}
