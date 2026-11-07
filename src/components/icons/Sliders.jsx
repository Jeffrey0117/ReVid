import { Icon } from './Icon';

export const Sliders = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
        <path d="M1 14h6M9 8h6M17 16h6" />
    </Icon>
);
