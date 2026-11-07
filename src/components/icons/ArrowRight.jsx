import { Icon } from './Icon';

export const ArrowRight = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
    </Icon>
);
