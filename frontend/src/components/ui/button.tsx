"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 cursor-pointer squircle-inner focus-visible:outline-2 focus-visible:outline-[var(--studio-mint)] focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--studio-mint)] text-[#0B0D11] font-semibold hover:brightness-105 border border-transparent",
        secondary:
          "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-hairline)] hover:border-[var(--border-active)] hover:bg-[var(--bg-elevated-hover)]",
        soft: "bg-[var(--studio-mint-soft)] text-[var(--text-primary)] border border-[var(--border-active)] hover:brightness-110",
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--text-primary)]",
        danger:
          "bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)] border border-[var(--studio-vermilion)]/30 hover:bg-[var(--studio-vermilion)] hover:text-[#0B0D11]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
