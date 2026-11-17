"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 cursor-pointer squircle-inner focus-visible:outline-2 focus-visible:outline-[#3A7269] focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary: "bg-[#3A7269] text-white hover:bg-[#316058] border border-transparent",
        secondary:
          "bg-[#FFFFFF] text-[#182220] border border-[rgba(24,34,32,0.08)] hover:border-[rgba(58,114,105,0.35)] hover:bg-[#F5F5F7]",
        soft: "bg-[#EBF3F1] text-[#182220] border border-[rgba(58,114,105,0.18)] hover:bg-[#DFECE9]",
        ghost: "bg-transparent text-[#52605D] hover:bg-[#F5F5F7] hover:text-[#182220]",
        danger: "bg-[#FFF1F3] text-[#BE123C] border border-[rgba(190,18,60,0.2)] hover:bg-[#FFE4E8]",
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
