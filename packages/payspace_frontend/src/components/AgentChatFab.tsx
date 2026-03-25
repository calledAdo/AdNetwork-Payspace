import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendCampaignAgentChat, sendPublisherAgentChat } from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface AgentChatFabProps {
  agentName: string;
  agentId: string;
  agentType: "buyer" | "seller";
  subjectType?: "campaign" | "seller_profile";
  subjectId?: string;
  initialMessage?: string;
}

export function AgentChatFab({
  agentName,
  agentId,
  agentType,
  subjectType,
  subjectId,
  initialMessage,
}: AgentChatFabProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      role: "assistant",
      content: initialMessage || `Hey! I'm your ${agentType === "buyer" ? "Buyer" : "Seller"} Agent (${agentId}). How can I help you today?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setError(null);
    setIsTyping(true);

    try {
      let reply = "";
      if (subjectType === "campaign" && subjectId) {
        reply = await sendCampaignAgentChat(subjectId, userMsg.content);
      } else if (subjectType === "seller_profile" && subjectId) {
        reply = await sendPublisherAgentChat(subjectId, userMsg.content);
      } else {
        const responses = agentType === "buyer"
          ? [
              "I've analyzed the latest performance data. Your EU placements are outperforming US by 18% on CTR. Want me to reallocate budget?",
              "Done. I've shifted 20% of the US budget to EU placements. The new bid prices will take effect in the next auction cycle.",
              "I can also set up A/B testing for your ad creatives across different publisher slots. Shall I proceed?",
            ]
          : [
              "Your header-banner slot has a 92% fill rate. I'd recommend increasing the floor price by 5-10% to maximize revenue without hurting fill.",
              "I've generated an updated snippet for your new placement. Check the placement details for the integration code.",
              "I'm monitoring bid requests in real-time. Three new advertisers are bidding on your inventory this hour.",
            ];
        reply = responses[Math.floor(Math.random() * responses.length)];
      }
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "assistant", content: reply },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTyping(false);
    }
  };

  const accentColor = agentType === "buyer" ? "primary" : "accent";

  return (
    <>
      {/* FAB Button */}
      <motion.button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${
          open
            ? "bg-muted text-muted-foreground"
            : agentType === "buyer"
            ? "bg-primary text-primary-foreground glow-cyan"
            : "bg-accent text-accent-foreground glow-purple"
        }`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </motion.button>

      {/* Chat Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 right-6 z-50 w-96 h-[500px] glass-strong rounded-2xl flex flex-col overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border/50 flex items-center gap-3">
              <div className={`h-8 w-8 rounded-lg bg-gradient-to-br from-${accentColor}/20 to-${accentColor}/40 border border-${accentColor}/30 flex items-center justify-center`}>
                <Bot className={`h-4 w-4 text-${accentColor}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{agentName}</p>
                <p className="text-xs text-muted-foreground font-mono">{agentId}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                Online
              </span>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                      msg.role === "assistant"
                        ? `bg-${accentColor}/10 border border-${accentColor}/20`
                        : "bg-muted border border-border"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <Bot className={`h-3 w-3 text-${accentColor}`} />
                    ) : (
                      <User className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      msg.role === "assistant"
                        ? "bg-background/60 text-foreground"
                        : `bg-${accentColor}/10 border border-${accentColor}/20 text-foreground`
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex gap-2">
                  <div className={`h-6 w-6 rounded-md bg-${accentColor}/10 border border-${accentColor}/20 flex items-center justify-center`}>
                    <Bot className={`h-3 w-3 text-${accentColor}`} />
                  </div>
                  <div className="bg-background/60 rounded-xl px-3 py-2">
                    <div className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className={`h-1.5 w-1.5 rounded-full bg-${accentColor}/60 animate-pulse`} style={{ animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-3 border-t border-border/50">
              {error && (
                <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
                  placeholder="Message your agent..."
                  className="flex-1 bg-background/40 border border-border/50 rounded-lg px-3 py-2 text-xs outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground"
                />
                <Button
                  size="icon"
                  onClick={() => void send()}
                  disabled={!input.trim()}
                  className={`h-8 w-8 rounded-lg bg-${accentColor} text-${accentColor}-foreground hover:bg-${accentColor}/90 disabled:opacity-30`}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
