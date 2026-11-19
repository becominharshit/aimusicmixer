"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 cursor-pointer rounded-none focus-visible:outline-2 focus-visible:outline-[#FF3B1F] dark:focus-visible:outline-[#FFE01B] focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary:
          "bg-[#FFE01B] text-[#0A0A0A] font-bold border border-[#0A0A0A] dark:border-[#FFE01B] hover:bg-[#0A0A0A] hover:text-[#FFE01B] dark:hover:bg-[#F4F1EA] dark:hover:text-[#0A0A0A]",
        secondary:
          "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-hairline)] hover:border-[var(--border-active)] hover:bg-[var(--bg-elevated-hover)]",
        soft:
          "bg-[var(--studio-yellow-soft)] text-[var(--text-primary)] border border-[var(--border-active)] hover:bg-[#FFE01B] hover:text-[#0A0A0A]",
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--text-primary)]",
        danger:
          "bg-[var(--studio-vermilion-soft)] text-[var(--studio-vermilion)] border border-[var(--studio-vermilion)] hover:bg-[#FF3B1F] hover:text-[#0A0A0A]",
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
