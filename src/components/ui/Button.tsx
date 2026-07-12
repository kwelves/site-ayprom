"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-blue-700",
        secondary: "border border-slate-300 bg-secondary text-secondary-foreground hover:bg-muted",
      },
      size: {
        default: "h-11 px-5 text-sm",
        sm: "h-9 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
);

const MotionLink = motion.create(Link);

interface ButtonProps extends VariantProps<typeof buttonStyles> {
  children: React.ReactNode;
  className?: string;
  href?: string;
  type?: "button" | "submit";
  onClick?: () => void;
}

export function Button({ href, type = "button", variant, size, className, children, onClick }: ButtonProps) {
  const classes = cn(buttonStyles({ variant, size }), className);
  const shouldReduceMotion = useReducedMotion();
  const tapFeedback = shouldReduceMotion
    ? {}
    : { whileHover: { scale: 1.03 }, whileTap: { scale: 0.97 }, transition: springSnappy };

  if (href) {
    return (
      <MotionLink href={href} className={classes} onClick={onClick} {...tapFeedback}>
        {children}
      </MotionLink>
    );
  }

  return (
    <motion.button type={type} className={classes} onClick={onClick} {...tapFeedback}>
      {children}
    </motion.button>
  );
}
