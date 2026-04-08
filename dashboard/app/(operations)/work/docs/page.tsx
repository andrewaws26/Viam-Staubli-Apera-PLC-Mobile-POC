"use client";

import { DocsLayout } from "@/components/docs/DocsLayout";
import {
  DocSection, H3, P, BulletList, NumberedList, Table,
  Steps, InfoBox, Warning, Badge,
} from "@/components/docs/DocComponents";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "work-board", label: "Work Board" },
  { id: "creating-wo", label: "Creating a Work Order" },
  { id: "subtasks", label: "Subtasks" },
  { id: "lifecycle", label: "Work Order Lifecycle" },
  { id: "linking-dtcs", label: "Linking DTCs" },
  { id: "notes-chat", label: "Notes & Chat" },
  { id: "team-chat", label: "Team Chat" },
  { id: "ai-mentions", label: "@ai Mentions" },
  { id: "reactions", label: "Reactions" },
  { id: "snapshots", label: "Sensor Snapshots" },
  { id: "roles", label: "Roles & Access" },
  { id: "tips", label: "Tips" },
] as const;

export default function OperationsDocsPage() {
  return (
    <DocsLayout
      title="Operations — User Guide"
      subtitle="Work orders and team chat for operational coordination across the fleet."
      sections={sections}
    >
      <DocSection id="overview" title="Overview">
        <P>
          IronSight Operations consists of two tightly integrated systems: <strong>Work Orders</strong> for
          tracking maintenance and repair tasks, and <strong>Team Chat</strong> for real-time coordination.
          Work orders give structure to what needs to be done. Team chat enables the conversation around it.
        </P>
        <H3>Key features</H3>
        <BulletList
          items={[
            "Kanban work board with drag-and-drop between status columns",
            "Subtask checklists for step-by-step completion tracking",
            "Entity-anchored chat threads — every truck, work order, and DTC gets its own thread",
            "Sensor snapshots auto-captured in chat messages for diagnostic context",
            "@ai mentions for inline AI diagnostic input in any thread",
            "Domain-specific reactions (thumbs up, wrench, checkmark, eyes)",
          ]}
        />
      </DocSection>

      <DocSection id="work-board" title="Work Board">
        <P>
          The work board at <strong>/work</strong> displays all active work orders in a Kanban-style
          view with four columns:
        </P>
        <Table
          headers={["Column", "Meaning", "Color"]}
          rows={[
            ["Open", "New work orders not yet started", "Gray"],
            ["In Progress", "Actively being worked on", "Blue"],
            ["Blocked", "Waiting on parts, information, or another task", "Red"],
            ["Done", "Completed work", "Green"],
          ]}
        />
        <H3>Work order cards</H3>
        <P>
          Each card shows the work order title, priority badge, assigned truck (if any), assignee,
          due date, and subtask completion progress (e.g., &quot;3/5 steps done&quot;).
        </P>
        <H3>My Work filter</H3>
        <P>
          Toggle &quot;My Work&quot; to filter the board to only show work orders assigned to you.
          This is the default view for operators and mechanics.
        </P>
        <H3>Drag and drop</H3>
        <P>
          Drag work order cards between columns to change their status. Moving to &quot;Blocked&quot;
          prompts for a reason (what&apos;s blocking progress).
        </P>
      </DocSection>

      <DocSection id="creating-wo" title="Creating a Work Order">
        <NumberedList
          items={[
            "Go to /work",
            "Click \"New Work Order\"",
            "Enter a title (required) and description",
            "Set priority: Urgent, Normal, or Low",
            "Assign to a truck (optional — links the WO to a specific vehicle)",
            "Assign to a person (optional — who will do the work)",
            "Set a due date (optional)",
            "Add subtasks as a checklist of steps to complete",
            "Save — the work order appears in the \"Open\" column",
          ]}
        />
        <H3>Priority levels</H3>
        <Table
          headers={["Priority", "When to Use"]}
          rows={[
            ["Urgent", "Safety issue, truck down, or blocking production"],
            ["Normal", "Standard maintenance or repair task"],
            ["Low", "Nice-to-have, can wait until convenient"],
          ]}
        />
        <H3>AI-suggested steps</H3>
        <P>
          When creating a work order, IronSight can generate suggested subtasks using AI.
          Enter a title and optionally DTC codes, and the AI produces 4–12 mechanic-grade
          action steps logically ordered from diagnosis to repair.
        </P>
      </DocSection>

      <DocSection id="subtasks" title="Subtasks">
        <P>
          Each work order can have a checklist of subtasks. These provide a step-by-step
          completion path for the work.
        </P>
        <BulletList
          items={[
            "Add subtasks when creating or editing a work order",
            "Check off subtasks as you complete each step",
            "Subtasks show completion progress on the work board card (e.g., \"3/5\")",
            "Reorder subtasks by their sort order",
            "Subtasks are optional — simple work orders don't need them",
          ]}
        />
      </DocSection>

      <DocSection id="lifecycle" title="Work Order Lifecycle">
        <Steps
          items={[
            { label: "Open", desc: "Created. Not yet started." },
            { label: "In Progress", desc: "Actively being worked on." },
            { label: "Blocked", desc: "Waiting on something. Requires a reason." },
            { label: "Done", desc: "Completed. Subtasks checked off." },
          ]}
        />
        <H3>Status transitions</H3>
        <BulletList
          items={[
            "Open → In Progress: When you start working on it",
            "In Progress → Blocked: When you hit a dependency (parts, information, etc.)",
            "Blocked → In Progress: When the blocker is resolved",
            "Any status → Done: When all work is complete",
            "Done → Open: To reopen if further work is needed",
          ]}
        />
        <H3>What gets logged</H3>
        <P>
          Every status change, creation, update, and deletion is recorded in the audit log
          with the user, timestamp, and details.
        </P>
      </DocSection>

      <DocSection id="linking-dtcs" title="Linking DTCs">
        <P>
          Work orders can be linked to diagnostic trouble codes from truck readings. When
          a DTC triggers a repair, linking it to the work order provides context for the
          mechanic and creates a traceable connection between the fault and the fix.
        </P>
        <BulletList
          items={[
            "DTCs from truck dashboard readings can be linked to work orders",
            "Linked codes appear on the work order detail view",
            "This helps track which DTCs led to which repairs",
            "The AI diagnostic system can reference linked DTCs when providing guidance",
          ]}
        />
      </DocSection>

      <DocSection id="notes-chat" title="Notes & Chat">
        <P>
          Each work order has an associated chat thread that is auto-created when the work
          order is first accessed. Use it for discussion, updates, and coordination around
          the specific task.
        </P>
        <BulletList
          items={[
            "Chat threads are entity-anchored — the thread belongs to the work order",
            "All thread members receive notifications for new messages",
            "Sensor snapshots are auto-attached when sending messages from a truck context",
            "Use @ai to get AI diagnostic input on work order issues",
          ]}
        />
      </DocSection>

      <DocSection id="team-chat" title="Team Chat">
        <P>
          Team chat at <strong>/chat</strong> is the central communication hub. Every conversation
          is anchored to a domain entity — there are no &quot;general&quot; channels.
        </P>
        <H3>Thread types</H3>
        <Table
          headers={["Type", "Auto-Created", "Purpose"]}
          rows={[
            ["Truck", "Yes, on first access", "Discussion about a specific vehicle"],
            ["Work Order", "Yes, on first access", "Coordination around a repair task"],
            ["DTC", "Yes, on first access", "Discussion about a specific trouble code"],
            ["Direct Message", "Manual", "Private conversation between two people"],
          ]}
        />
        <H3>Creating a DM</H3>
        <NumberedList
          items={[
            "Go to /chat",
            "Click \"New Message\"",
            "Select a person from the user picker",
            "Start typing — the DM thread is created automatically",
          ]}
        />
        <H3>Thread list</H3>
        <P>
          The left sidebar shows all threads you&apos;re a member of, sorted by most recent
          activity. Unread threads show a badge. Click a thread to open it in the main panel.
        </P>
        <H3>Polling</H3>
        <P>
          Chat polls for new messages every 3 seconds when a thread is open, and every
          5 seconds for the thread list. Push notifications are sent via Expo for the
          mobile app.
        </P>
      </DocSection>

      <DocSection id="ai-mentions" title="@ai Mentions">
        <P>
          Type <strong>@ai</strong> in any chat thread to get AI diagnostic input. The AI
          receives the last 10 messages in the thread plus a live sensor snapshot (if the
          thread is anchored to a truck or work order with a truck).
        </P>
        <H3>How it works</H3>
        <NumberedList
          items={[
            "Type your message and include @ai anywhere in the text",
            "Send the message — it appears as your normal message",
            "The AI processes the thread context + sensor data",
            "An AI response appears as a message from \"AI Mechanic\"",
            "All thread members see the AI response",
          ]}
        />
        <H3>Best practices</H3>
        <BulletList
          items={[
            "Be specific: \"@ai what could cause SPN 110 FMI 0 on this truck?\" works better than \"@ai help\"",
            "The AI sees other messages in the thread — reference previous discussion naturally",
            "Responses are shorter than the truck dashboard AI — optimized for group chat",
            "The AI ends responses with 1-2 follow-up questions",
          ]}
        />
      </DocSection>

      <DocSection id="reactions" title="Reactions">
        <P>
          IronSight uses four domain-specific reactions instead of generic emoji. Each has a
          meaning in the context of fleet operations:
        </P>
        <Table
          headers={["Reaction", "Icon", "Meaning"]}
          rows={[
            ["Thumbs Up", "👍", "Acknowledged, agree, or approved"],
            ["Wrench", "🔧", "I'll handle this / taking action"],
            ["Checkmark", "✅", "Done / confirmed / verified"],
            ["Eyes", "👀", "Looking into it / reviewing"],
          ]}
        />
        <P>
          Click a reaction to toggle it. Reactions are visible to all thread members.
        </P>
      </DocSection>

      <DocSection id="snapshots" title="Sensor Snapshots">
        <P>
          When you send a chat message from a truck context (truck chat tab or work order
          linked to a truck), the system automatically captures a snapshot of the truck&apos;s
          live sensor readings at that moment.
        </P>
        <BulletList
          items={[
            "Snapshots appear as expandable cards below the message",
            "They show key readings: RPM, coolant temp, oil pressure, battery, DTCs, etc.",
            "This creates a timestamped record of what the truck was doing when the message was sent",
            "Useful for \"the truck was showing X when I noticed Y\" conversations",
            "Snapshots are read-only records — they can't be edited after capture",
          ]}
        />
        <InfoBox title="Why snapshots matter">
          By the time a mechanic reads your message, the truck&apos;s readings may have changed.
          Snapshots preserve the exact state at the time you wrote the message, so everyone
          is looking at the same data when discussing an issue.
        </InfoBox>
      </DocSection>

      <DocSection id="roles" title="Roles & Access">
        <Table
          headers={["Role", "Work Orders", "Team Chat"]}
          rows={[
            ["Operator", "View only — cannot create or edit", "Full access — send/receive messages"],
            ["Mechanic", "Full access — create, edit, update status", "Full access"],
            ["Manager", "Full access + assign to anyone", "Full access"],
            ["Developer", "Full access", "Full access"],
          ]}
        />
        <P>
          All roles can view the work board and participate in team chat. Creating and
          managing work orders requires <Badge>Mechanic</Badge> role or higher.
        </P>
      </DocSection>

      <DocSection id="tips" title="Tips">
        <H3>When to create a work order vs. just chatting</H3>
        <BulletList
          items={[
            "Create a WO when: there's a defined task with steps to complete, you need to track progress, or someone needs to be assigned",
            "Just chat when: you're asking a quick question, sharing an observation, or the issue may resolve itself",
            "Rule of thumb: if it needs to be done, make it a work order. If it needs to be discussed, use chat.",
          ]}
        />
        <H3>Using Blocked status effectively</H3>
        <BulletList
          items={[
            "Always include a reason when blocking — \"waiting for parts\" tells the team what's needed",
            "Check blocked work orders daily — blockers may have been resolved",
            "Use blocked status instead of leaving work orders \"in progress\" when you can't proceed",
          ]}
        />
        <H3>Subtask tips</H3>
        <BulletList
          items={[
            "Use AI-suggested steps for common repairs — they follow a logical diagnosis-to-repair order",
            "Keep steps specific: \"Check oil pressure\" is better than \"Inspect engine\"",
            "Check off steps as you go — the progress indicator keeps the team informed",
          ]}
        />
      </DocSection>
    </DocsLayout>
  );
}
