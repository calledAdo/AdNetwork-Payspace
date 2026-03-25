import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendAssistantMessage } from "@/lib/api";
import {
  parseAssistantDraft,
  stripAssistantDraft,
  type AssistantDraftEnvelope,
} from "@/lib/assistantDraft";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "backend" | "agent";
};

type AssistantThreadPanelProps = {
  title: string;
  subtitle: string;
  subjectType: "seller_profile" | "campaign" | null;
  subjectId: string | null;
  placeholder: string;
  initialAssistantMessage?: string;
  initialUserMessage?: string;
  context?: Record<string, unknown>;
  onAssistantReply?: (
    draft: AssistantDraftEnvelope | null,
    rawReply: string,
  ) => void;
};

export function AssistantThreadPanel({
  title,
  subtitle,
  subjectType,
  subjectId,
  placeholder,
  initialAssistantMessage,
  initialUserMessage,
  context,
  onAssistantReply,
}: AssistantThreadPanelProps) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialAssistantMessage
      ? [
          {
            id: "init",
            role: "assistant",
            content: initialAssistantMessage,
            source: "backend",
          },
        ]
      : [],
  );
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSentInitialMessage = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: content.trim(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setError(null);
    setIsSending(true);

    try {
      const response = await sendAssistantMessage({
        thread_id: threadId,
        subject_type: subjectType,
        subject_id: subjectId,
        message: userMessage.content,
        route_mode: "auto",
        context,
      });

      const draft = parseAssistantDraft(response.reply);
      const visibleReply = stripAssistantDraft(response.reply);
      onAssistantReply?.(draft, response.reply);
      setThreadId(response.thread_id);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: visibleReply,
          source: response.response_source,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  };

  const send = async () => {
    if (!input.trim()) return;
    const content = input.trim();
    setInput("");
    await sendMessage(content);
  };

  useEffect(() => {
    if (!initialUserMessage || autoSentInitialMessage.current) return;
    autoSentInitialMessage.current = true;
    void sendMessage(initialUserMessage);
  }, [initialUserMessage]);

  return (
    <div className="glass-strong rounded-3xl overflow-hidden border border-border/40 shadow-2xl">
      <div className="border-b border-border/40 px-5 py-4 bg-background/30">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>

      <div
        ref={scrollRef}
        className="h-[540px] overflow-y-auto px-4 py-5 space-y-3 bg-gradient-to-b from-background/10 via-background/20 to-background/5"
      >
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex items-end gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "assistant" && (
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center flex-shrink-0 mb-1">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}

              <div
                className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                  message.role === "assistant"
                    ? "bg-background/80 border border-border/50 text-foreground rounded-bl-md"
                    : "bg-primary text-primary-foreground rounded-br-md"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.role === "assistant" && message.source && (
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {message.source === "agent" ? "Agent reply" : "Backend guide"}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isSending && (
          <div className="flex items-end gap-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center mb-1">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="bg-background/80 border border-border/50 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-2 rounded-full bg-primary/60 animate-pulse"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border/40 bg-background/40 backdrop-blur-xl px-4 py-3 sticky bottom-0">
        {error && (
          <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-2 items-end rounded-2xl border border-border/50 bg-background/80 px-3 py-2 shadow-inner">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={placeholder}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none resize-none text-sm px-1 py-2 text-foreground placeholder:text-muted-foreground max-h-32"
          />
          <Button
            size="icon"
            onClick={() => void send()}
            disabled={!input.trim() || isSending}
            className="h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
