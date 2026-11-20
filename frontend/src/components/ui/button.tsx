"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 cursor-pointer rounded-[4px] focus-visible:outline-2 focus-visible:outline-[#E85D4A] dark:focus-visible:outline-[#F0B44C] focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary:
          "bg-[#F0B44C] text-[#111318] font-bold border border-[#14171F] dark:border-[#F0B44C] hover:bg-[#F5C451] hover:text-[#111318] dark:hover:bg-[#F5C76B] dark:hover:text-[#111318]",
        secondary:
          "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-hairline)] hover:border-[var(--border-active)] hover:bg-[var(--bg-elevated-hover)]",
        soft:
          "bg-[var(--studio-yellow-soft)] text-[var(--text-primary)] border border-[var(--border-active)] hover:bg-[#F0B44C] hover:text-[#111318]",
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--text-primary)]",
        danger:
          "bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)] border border-[var(--studio-vermilion)] hover:bg-[#EF6B63] hover:text-[#111318]",
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
